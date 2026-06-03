import { BaseCacheManager, KeyBuilder, TTLManager, ValidationError } from '@nodellmcache/core'
import type {
  CacheEntry,
  CacheOptions,
  CacheStats,
  CacheType,
  MetricsSink,
  StorageAdapter,
} from '@nodellmcache/core'

/** A single embedding vector. */
export type Embedding = number[]

export interface EmbeddingCacheManagerOptions {
  /** Storage backend (injected). For compact storage, use an adapter with lz4/auto compression. */
  adapter: StorageAdapter<Embedding>
  /** Default relative TTL (ms). Embeddings are stable, so this defaults to none (permanent until evicted). */
  defaultTTL?: number
  /** Downstream metrics sink. */
  metrics?: MetricsSink
}

/** Per-call options; `dimensions` is folded into the key so re-dimensioned models don't collide. */
export interface EmbeddingCacheOptions extends CacheOptions {
  dimensions?: number
}

/** Hit/miss stats enriched with embedding-specific reuse figures. */
export interface EmbeddingCacheStats extends CacheStats {
  /** Number of embeddings served from cache instead of generated. */
  embeddingsReused: number
  /** Embedding generations avoided = items requested − embeddings generated (cache hits + intra-batch dedup). */
  apiCallsAvoided: number
}

/**
 * Caches vector embeddings keyed by input text, provider, model, and optional
 * dimensions. The headline feature is {@link getBatch}, which only invokes the
 * generator for inputs not already cached, deduplicates repeated inputs, and
 * returns results in the original input order.
 *
 * Embeddings are stored as `number[]`; pair with a compression-enabled adapter
 * (the `'embedding'` cache type triggers the lz4 hint in `@nodellmcache/memory`)
 * for a compact footprint.
 */
export class EmbeddingCache extends BaseCacheManager<Embedding> {
  protected readonly cacheType: CacheType = 'embedding'

  private hitCount = 0
  private missCount = 0
  private requested = 0
  private generated = 0

  constructor(options: EmbeddingCacheManagerOptions) {
    super({ adapter: options.adapter, defaultTTL: options.defaultTTL, metrics: options.metrics })
  }

  /**
   * Returns a single embedding, generating and caching it on a miss. Implemented
   * on top of {@link getBatch} so all accounting flows through one path.
   */
  override async getOrGenerate(
    input: string,
    generator: () => Promise<Embedding>,
    options?: EmbeddingCacheOptions,
  ): Promise<Embedding> {
    const [embedding] = await this.getBatch([input], async () => [await generator()], options)
    return embedding!
  }

  /**
   * Batch-resolves embeddings. The `generator` receives only the inputs not
   * found in cache (deduplicated, first-seen order) and must return embeddings
   * in that same order. Results are returned aligned to `inputs`.
   */
  async getBatch(
    inputs: string[],
    generator: (uncached: string[]) => Promise<Embedding[]>,
    options?: EmbeddingCacheOptions,
  ): Promise<Embedding[]> {
    this.requested += inputs.length

    const keys = inputs.map((input) => this.buildKey(input, options))
    const results = new Array<Embedding | undefined>(inputs.length)
    const uncachedOrder: string[] = []
    const seen = new Set<string>()

    // Lookup pass.
    for (let i = 0; i < inputs.length; i++) {
      const start = Date.now()
      const cached = await this.adapter.get(keys[i]!)
      if (cached && !TTLManager.isExpired(cached)) {
        results[i] = cached.value
        this.hitCount++
        this.metrics.emit('cache.hit', {
          cacheType: this.cacheType,
          latencyMs: Date.now() - start,
          provider: options?.provider,
          model: options?.model,
        })
      } else {
        this.missCount++
        this.metrics.emit('cache.miss', {
          cacheType: this.cacheType,
          latencyMs: Date.now() - start,
          provider: options?.provider,
          model: options?.model,
        })
        const input = inputs[i]!
        if (!seen.has(input)) {
          seen.add(input)
          uncachedOrder.push(input)
        }
      }
    }

    if (uncachedOrder.length > 0) {
      const produced = await generator(uncachedOrder)
      if (produced.length !== uncachedOrder.length) {
        throw new ValidationError(
          `Embedding generator returned ${produced.length} vectors for ${uncachedOrder.length} inputs`,
        )
      }
      this.generated += uncachedOrder.length

      const ttl = options?.ttl ?? this.defaultTTL
      const byInput = new Map<string, Embedding>()
      for (let j = 0; j < uncachedOrder.length; j++) {
        const input = uncachedOrder[j]!
        const embedding = produced[j]!
        byInput.set(input, embedding)
        const entry = this.buildEntry(this.buildKey(input, options), embedding, options)
        await this.adapter.set(entry.key, entry, ttl)
        this.metrics.emit('cache.set', {
          cacheType: this.cacheType,
          latencyMs: 0,
          provider: options?.provider,
          model: options?.model,
        })
      }

      for (let i = 0; i < inputs.length; i++) {
        if (results[i] === undefined) results[i] = byInput.get(inputs[i]!)!
      }
    }

    return results as Embedding[]
  }

  override async stats(): Promise<EmbeddingCacheStats> {
    const total = this.hitCount + this.missCount
    const adapterStats = await this.adapter.stats()
    return {
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total === 0 ? 0 : this.hitCount / total,
      entryCount: adapterStats.entryCount,
      embeddingsReused: this.hitCount,
      apiCallsAvoided: this.requested - this.generated,
    }
  }

  protected override buildKey(input: string, options?: CacheOptions): string {
    const dimensions = (options as EmbeddingCacheOptions | undefined)?.dimensions
    const model = options?.model ?? 'default'
    const modelSegment = dimensions ? `${model}@${dimensions}` : model
    return KeyBuilder.build(this.cacheType, options?.provider ?? 'unknown', modelSegment, input)
  }
}
