import { KeyBuilder } from './KeyBuilder.js'
import { TTLManager } from './TTLManager.js'
import type {
  CacheEntry,
  CacheOptions,
  CacheStats,
  MetricsSink,
  StorageAdapter,
} from './interfaces.js'
import type { CacheType } from './types.js'

/** A metrics sink that discards everything; the default when none is injected. */
export const noopMetrics: MetricsSink = {
  emit() {
    // intentionally empty
  },
}

/**
 * Construction options shared by all cache managers.
 */
export interface BaseCacheManagerOptions<T> {
  adapter: StorageAdapter<T>
  /** Default relative TTL in milliseconds applied to entries lacking their own. */
  defaultTTL?: number
  /** Metrics sink; defaults to a no-op so core stays dependency-free. */
  metrics?: MetricsSink
}

/**
 * Shared base for every feature cache (prompt, embedding, semantic, ...).
 *
 * Provides the cache-aside `getOrGenerate` flow, key building, entry
 * construction, invalidation, and hit/miss accounting. Subclasses declare their
 * {@link CacheType} and may override {@link buildKey} for custom namespacing.
 */
export abstract class BaseCacheManager<T> {
  /** The workload category for keys and metrics. */
  protected abstract readonly cacheType: CacheType

  protected readonly adapter: StorageAdapter<T>
  protected readonly defaultTTL: number | undefined
  protected readonly metrics: MetricsSink

  private hits = 0
  private misses = 0
  /** Keys with an in-flight background revalidation, to avoid duplicate refreshes. */
  private readonly refreshing = new Set<string>()

  constructor(options: BaseCacheManagerOptions<T>) {
    this.adapter = options.adapter
    this.defaultTTL = options.defaultTTL
    this.metrics = options.metrics ?? noopMetrics
  }

  /**
   * Builds the storage key for an input. Defaults to the canonical
   * `{type}:{provider}:{model}:{hash}` format via {@link KeyBuilder}.
   */
  protected buildKey(input: string, options?: CacheOptions): string {
    return KeyBuilder.build(
      this.cacheType,
      options?.provider ?? 'unknown',
      options?.model ?? 'default',
      input,
    )
  }

  /**
   * Wraps a value in a {@link CacheEntry} with computed expiry and metadata.
   */
  protected buildEntry(key: string, value: T, options?: CacheOptions): CacheEntry<T> {
    const createdAt = Date.now()
    const ttl = options?.ttl ?? this.defaultTTL
    const staleTtl = options?.staleTtl
    return {
      key,
      value,
      createdAt,
      expiresAt: TTLManager.computeExpiresAt(createdAt, ttl),
      metadata: {
        compressed: false,
        originalSize: 0,
        cacheType: this.cacheType,
        provider: options?.provider,
        model: options?.model,
        tokenCount: options?.tokenCount,
        staleAt:
          staleTtl !== undefined && staleTtl > 0 ? createdAt + staleTtl : undefined,
      },
    }
  }

  /**
   * Cache-aside read-through. Returns the cached value on a hit, otherwise
   * invokes `generator`, stores the result, and returns it. Set
   * `options.cache = false` to bypass the cache for both read and write.
   */
  async getOrGenerate(
    input: string,
    generator: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    // A deliberate bypass is neither a hit nor a miss — skip the cache and
    // metrics entirely so accounting reflects only real cache consultations.
    if (options?.cache === false) {
      return generator()
    }

    const key = this.buildKey(input, options)
    const start = Date.now()

    const cached = await this.adapter.get(key)
    if (cached && !TTLManager.isExpired(cached)) {
      this.hits++
      this.metrics.emit('cache.hit', {
        cacheType: this.cacheType,
        latencyMs: Date.now() - start,
        tokensSaved: cached.metadata.tokenCount,
        provider: options?.provider,
        model: options?.model,
      })
      return cached.value
    }

    this.misses++
    this.metrics.emit('cache.miss', {
      cacheType: this.cacheType,
      latencyMs: Date.now() - start,
      provider: options?.provider,
      model: options?.model,
    })

    const value = await generator()
    await this.persist(key, value, options, start)
    return value
  }

  /**
   * Stale-while-revalidate read-through. Like {@link getOrGenerate}, but when a
   * cached entry is *stale* (past its `staleTtl`/`staleAt` but not yet expired)
   * it is returned immediately and a fresh value is fetched in the background.
   * Concurrent stale hits for the same key trigger at most one background
   * refresh. A failed background refresh is swallowed and the stale value stands
   * until it fully expires.
   */
  async getOrRevalidate(
    input: string,
    generator: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    if (options?.cache === false) {
      return generator()
    }

    const key = this.buildKey(input, options)
    const start = Date.now()

    const cached = await this.adapter.get(key)
    if (cached && !TTLManager.isExpired(cached)) {
      this.hits++
      this.metrics.emit('cache.hit', {
        cacheType: this.cacheType,
        latencyMs: Date.now() - start,
        tokensSaved: cached.metadata.tokenCount,
        provider: options?.provider,
        model: options?.model,
      })
      const staleAt = cached.metadata.staleAt
      if (staleAt !== undefined && staleAt <= Date.now()) {
        this.revalidate(key, generator, options)
      }
      return cached.value
    }

    this.misses++
    this.metrics.emit('cache.miss', {
      cacheType: this.cacheType,
      latencyMs: Date.now() - start,
      provider: options?.provider,
      model: options?.model,
    })

    const value = await generator()
    await this.persist(key, value, options, start)
    return value
  }

  /**
   * Removes a single entry by its input (and namespacing options).
   */
  async invalidate(input: string, options?: CacheOptions): Promise<void> {
    await this.adapter.delete(this.buildKey(input, options))
  }

  /**
   * Returns hit/miss accounting for this manager plus the adapter's entry count.
   */
  async stats(): Promise<CacheStats> {
    const total = this.hits + this.misses
    const adapterStats = await this.adapter.stats()
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      entryCount: adapterStats.entryCount,
    }
  }

  /** Builds an entry, writes it through the adapter, and emits `cache.set`. */
  private async persist(
    key: string,
    value: T,
    options: CacheOptions | undefined,
    start: number,
  ): Promise<void> {
    const ttl = options?.ttl ?? this.defaultTTL
    const entry = this.buildEntry(key, value, options)
    await this.adapter.set(key, entry, ttl)
    this.metrics.emit('cache.set', {
      cacheType: this.cacheType,
      latencyMs: Date.now() - start,
      provider: options?.provider,
      model: options?.model,
    })
  }

  /** Fire-and-forget background refresh for a stale entry, coalesced per key. */
  private revalidate(key: string, generator: () => Promise<T>, options?: CacheOptions): void {
    if (this.refreshing.has(key)) return
    this.refreshing.add(key)
    void (async () => {
      try {
        const value = await generator()
        await this.persist(key, value, options, Date.now())
      } catch {
        // Swallow background-refresh failures: the stale value stands until expiry.
      } finally {
        this.refreshing.delete(key)
      }
    })()
  }
}
