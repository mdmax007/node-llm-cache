import { KeyBuilder, TTLManager } from '@nodellmcache/core'
import type {
  CacheEntry,
  CacheOptions,
  CacheStats,
  MetricsSink,
  StorageAdapter,
  VectorStoreAdapter,
} from '@nodellmcache/core'
import { InMemoryVectorIndex, VectorStoreIndex, type QueryMeta, type VectorIndex } from './VectorIndex.js'

/** Result of a semantic lookup. */
export interface SemanticResult<T> {
  value: T
  /** True when served from the cache (a match at or above the threshold). */
  fromCache: boolean
  /** Similarity of the best match (the matched entry on a hit; the nearest miss otherwise). */
  similarity: number
  /** On a hit, the original query whose response was reused. */
  matchedQuery?: string
}

/** Hit/miss stats enriched with semantic-specific figures. */
export interface SemanticCacheStats extends CacheStats {
  /** Hits that matched a *different* query (true fuzzy reuse, not an exact repeat). */
  semanticHits: number
  /** `semanticHits / total requests`. */
  semanticHitRate: number
}

export interface SemanticCacheOptions<T = string> {
  /** Storage backend for responses (injected). */
  adapter: StorageAdapter<T>
  /** Embeds a query into a vector. May be backed by `@nodellmcache/embedding-cache`. */
  embeddingFn: (text: string) => Promise<number[]>
  /** Minimum cosine similarity for a hit. Default 0.92. */
  similarityThreshold?: number
  /** Default relative TTL (ms) for stored responses. */
  defaultTTL?: number
  /** Downstream metrics sink. */
  metrics?: MetricsSink
  /** Optional vector database for large-scale similarity search (must score by cosine). */
  vectorStore?: VectorStoreAdapter<QueryMeta>
}

const noopMetrics: MetricsSink = { emit() {} }

/**
 * Caches LLM responses by **semantic similarity** of the prompt rather than
 * exact text. A query is embedded, compared (cosine) against previously seen
 * queries, and — if the best match clears `similarityThreshold` — the stored
 * response is reused.
 *
 * Unlike the hash-keyed caches, this manager does not extend `BaseCacheManager`:
 * its lookup is similarity-based and `getOrGenerate` returns a richer
 * {@link SemanticResult} (value + match info), so it composes the same building
 * blocks (adapter, metrics, keys) directly.
 */
export class SemanticCache<T = string> {
  private readonly adapter: StorageAdapter<T>
  private readonly embeddingFn: (text: string) => Promise<number[]>
  private readonly threshold: number
  private readonly defaultTTL: number | undefined
  private readonly metrics: MetricsSink
  private readonly index: VectorIndex

  private hits = 0
  private misses = 0
  private semanticHits = 0

  constructor(options: SemanticCacheOptions<T>) {
    this.adapter = options.adapter
    this.embeddingFn = options.embeddingFn
    this.threshold = options.similarityThreshold ?? 0.92
    this.defaultTTL = options.defaultTTL
    this.metrics = options.metrics ?? noopMetrics
    this.index = options.vectorStore
      ? new VectorStoreIndex(options.vectorStore)
      : new InMemoryVectorIndex()
  }

  /**
   * Returns a cached response for a semantically similar prior query, or
   * generates, stores, and returns a fresh one.
   */
  async getOrGenerate(
    query: string,
    generator: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<SemanticResult<T>> {
    const start = Date.now()
    const embedding = await this.embeddingFn(query)
    const match = await this.index.search(embedding)

    if (match && match.similarity >= this.threshold) {
      const cached = await this.adapter.get(match.id)
      if (cached && !TTLManager.isExpired(cached)) {
        this.hits++
        if (KeyBuilder.normalize(match.query) !== KeyBuilder.normalize(query)) {
          this.semanticHits++
        }
        this.metrics.emit('cache.hit', {
          cacheType: 'semantic',
          latencyMs: Date.now() - start,
          provider: options?.provider,
          model: options?.model,
        })
        return {
          value: cached.value,
          fromCache: true,
          similarity: match.similarity,
          matchedQuery: match.query,
        }
      }
      // The response expired or was evicted from the adapter — drop the stale index entry.
      await this.index.remove(match.id)
    }

    this.misses++
    this.metrics.emit('cache.miss', {
      cacheType: 'semantic',
      latencyMs: Date.now() - start,
      provider: options?.provider,
      model: options?.model,
    })

    const value = await generator()
    const key = KeyBuilder.build(
      'semantic',
      options?.provider ?? 'unknown',
      options?.model ?? 'default',
      query,
    )
    const ttl = options?.ttl ?? this.defaultTTL
    await this.adapter.set(key, this.buildEntry(key, value, options), ttl)
    await this.index.add(key, embedding, query)
    this.metrics.emit('cache.set', {
      cacheType: 'semantic',
      latencyMs: Date.now() - start,
      provider: options?.provider,
      model: options?.model,
    })

    return { value, fromCache: false, similarity: match ? match.similarity : 0 }
  }

  /** Clears all responses and the similarity index. */
  async clear(): Promise<void> {
    await this.adapter.clear()
    await this.index.clear()
  }

  async stats(): Promise<SemanticCacheStats> {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      entryCount: this.index.size(),
      semanticHits: this.semanticHits,
      semanticHitRate: total === 0 ? 0 : this.semanticHits / total,
    }
  }

  private buildEntry(key: string, value: T, options?: CacheOptions): CacheEntry<T> {
    const createdAt = Date.now()
    const ttl = options?.ttl ?? this.defaultTTL
    return {
      key,
      value,
      createdAt,
      expiresAt: TTLManager.computeExpiresAt(createdAt, ttl),
      metadata: {
        compressed: false,
        originalSize: 0,
        cacheType: 'semantic',
        provider: options?.provider,
        model: options?.model,
      },
    }
  }
}
