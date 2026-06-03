import {
  JsonSerializer,
  NodeLLMCacheError,
  TTLManager,
} from '@nodellmcache/core'
import type {
  AdapterStats,
  CacheEntry,
  CompressionAlgo,
  CompressionEngine,
  DataHint,
  MetricsSink,
  Serializer,
  StorageAdapter,
} from '@nodellmcache/core'
import { estimateSize } from './estimateSize.js'

/** Default capacity: 500 MB. */
const DEFAULT_MAX_SIZE = 500 * 1024 * 1024

/** How a stored value is held internally. */
type Payload<T> =
  | { kind: 'raw'; value: T }
  | { kind: 'compressed'; algo: CompressionAlgo; data: Buffer }

interface StoredEntry<T> {
  key: string
  createdAt: number
  expiresAt: number | undefined
  metadata: CacheEntry<T>['metadata']
  payload: Payload<T>
  sizeBytes: number
  timer: NodeJS.Timeout | undefined
}

export interface MemoryAdapterOptions {
  /** Maximum total bytes before LRU eviction kicks in. Default 500 MB. */
  maxSize?: number
  /** Default relative TTL (ms) applied when neither `set`'s ttl nor the entry carries one. */
  defaultTTL?: number
  /**
   * Compression mode. `false`/`'none'` (default) stores values by reference for
   * the fastest path. Any other algorithm — or `'auto'` — serializes and
   * compresses each value, trading CPU for memory.
   */
  compression?: false | CompressionAlgo
  /**
   * Compression engine to use when `compression` is enabled. If omitted, the
   * adapter lazily imports `@nodellmcache/compression`. Inject your own to
   * avoid that optional dependency.
   */
  compressionEngine?: CompressionEngine
  /** Serializer used only when compression is enabled. Defaults to JSON. */
  serializer?: Serializer
  /** Metrics sink; receives `cache.evict` on capacity evictions. Defaults to no-op. */
  metrics?: MetricsSink
}

/**
 * In-memory cache backend implementing {@link StorageAdapter}.
 *
 * - **LRU eviction** by approximate byte size against a configurable `maxSize`.
 * - **TTL** via per-entry timers plus a defensive read-time expiry check.
 * - **Optional compression** (serialize → compress on set, decompress →
 *   deserialize on get) when a compression mode is configured.
 *
 * Single value larger than `maxSize` is not stored (a later read simply misses).
 */
export class MemoryAdapter<T = unknown> implements StorageAdapter<T> {
  private readonly store = new Map<string, StoredEntry<T>>()
  private readonly maxSize: number
  private readonly defaultTTL: number | undefined
  private readonly compression: false | CompressionAlgo
  private readonly serializer: Serializer
  private readonly metrics: MetricsSink

  private totalSize = 0
  private evictions = 0
  private injectedEngine: CompressionEngine | undefined
  private enginePromise: Promise<CompressionEngine> | undefined

  constructor(options: MemoryAdapterOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE
    this.defaultTTL = options.defaultTTL
    this.compression =
      options.compression === undefined || options.compression === 'none'
        ? false
        : options.compression
    this.serializer = options.serializer ?? new JsonSerializer()
    this.metrics = options.metrics ?? { emit() {} }
    this.injectedEngine = options.compressionEngine
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    const stored = this.store.get(key)
    if (!stored) return null

    if (TTLManager.isExpired(stored)) {
      this.remove(key)
      return null
    }

    // Mark most-recently-used by reinserting at the tail.
    this.store.delete(key)
    this.store.set(key, stored)

    const value = await this.restore(stored.payload)
    return {
      key: stored.key,
      value,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
      metadata: stored.metadata,
    }
  }

  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    // Replacing an existing key: free its budget and timer first.
    if (this.store.has(key)) this.remove(key)

    const now = Date.now()
    const expiresAt =
      ttl !== undefined && ttl > 0
        ? now + ttl
        : (entry.expiresAt ?? TTLManager.computeExpiresAt(now, this.defaultTTL))

    const { payload, sizeBytes } = await this.encode(entry)

    // An item that can never fit is not cached.
    if (sizeBytes > this.maxSize) return

    this.evictUntilFits(sizeBytes)

    const timer = this.scheduleExpiry(key, expiresAt, now)
    this.store.set(key, {
      key,
      createdAt: entry.createdAt,
      expiresAt,
      metadata: entry.metadata,
      payload,
      sizeBytes,
      timer,
    })
    this.totalSize += sizeBytes
  }

  async delete(key: string): Promise<void> {
    this.remove(key)
  }

  async clear(): Promise<void> {
    for (const stored of this.store.values()) {
      if (stored.timer) clearTimeout(stored.timer)
    }
    this.store.clear()
    this.totalSize = 0
  }

  async has(key: string): Promise<boolean> {
    const stored = this.store.get(key)
    if (!stored) return false
    if (TTLManager.isExpired(stored)) {
      this.remove(key)
      return false
    }
    return true
  }

  async stats(): Promise<AdapterStats> {
    return {
      entryCount: this.store.size,
      sizeBytes: this.totalSize,
      evictions: this.evictions,
    }
  }

  // --- internals -----------------------------------------------------------

  /** Removes a key, clearing its timer and reclaiming its budget. */
  private remove(key: string): void {
    const stored = this.store.get(key)
    if (!stored) return
    if (stored.timer) clearTimeout(stored.timer)
    this.store.delete(key)
    this.totalSize -= stored.sizeBytes
  }

  /** Evicts least-recently-used entries until `incoming` bytes will fit. */
  private evictUntilFits(incoming: number): void {
    while (this.totalSize + incoming > this.maxSize && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value as string
      const cacheType = this.store.get(oldestKey)!.metadata.cacheType
      this.remove(oldestKey)
      this.evictions++
      this.metrics.emit('cache.evict', { cacheType, latencyMs: 0 })
    }
  }

  /** Schedules a self-deleting timer for an entry with an expiry. */
  private scheduleExpiry(
    key: string,
    expiresAt: number | undefined,
    now: number,
  ): NodeJS.Timeout | undefined {
    if (expiresAt === undefined) return undefined
    const delay = Math.max(0, expiresAt - now)
    const timer = setTimeout(() => this.remove(key), delay)
    // Don't keep the event loop alive for cache expiry.
    timer.unref?.()
    return timer
  }

  /** Builds the internal payload and computes its size budget. */
  private async encode(entry: CacheEntry<T>): Promise<{ payload: Payload<T>; sizeBytes: number }> {
    if (this.compression === false) {
      return { payload: { kind: 'raw', value: entry.value }, sizeBytes: estimateSize(entry.value) }
    }

    const engine = await this.getEngine()
    const serialized = this.serializer.serialize(entry.value)
    const hint: DataHint | undefined =
      entry.metadata.cacheType === 'embedding' ? 'embedding' : undefined

    if (this.compression === 'auto') {
      const result = await engine.auto(serialized, hint)
      return {
        payload: { kind: 'compressed', algo: result.algo, data: result.data },
        sizeBytes: result.compressedSize,
      }
    }

    const data = await engine.compress(serialized, this.compression)
    return { payload: { kind: 'compressed', algo: this.compression, data }, sizeBytes: data.length }
  }

  /** Reverses {@link encode} to recover the original value. */
  private async restore(payload: Payload<T>): Promise<T> {
    if (payload.kind === 'raw') return payload.value
    const engine = await this.getEngine()
    const decompressed = await engine.decompress(payload.data, payload.algo)
    return this.serializer.deserialize<T>(decompressed)
  }

  /** Resolves the compression engine, lazily importing the optional package. */
  private async getEngine(): Promise<CompressionEngine> {
    if (this.injectedEngine) return this.injectedEngine
    this.enginePromise ??= import('@nodellmcache/compression')
      .then((mod) => new mod.CompressionEngine())
      .catch((cause) => {
        throw new NodeLLMCacheError(
          'Compression is enabled but @nodellmcache/compression is not installed. ' +
            'Install it, or pass a compressionEngine to MemoryAdapter.',
          { cause },
        )
      })
    return this.enginePromise
  }
}
