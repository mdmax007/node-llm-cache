import { JsonSerializer, NodeLLMCacheError, TTLManager } from '@nodellmcache/core'
import type {
  AdapterStats,
  CacheEntry,
  CacheMetadata,
  CompressionAlgo,
  CompressionEngine,
  DataHint,
  Serializer,
  StorageAdapter,
} from '@nodellmcache/core'
import { createRedisClient, type RedisConnectionOptions } from './client.js'
import type { RedisClient } from './RedisClient.js'

/** Wire format stored in Redis (JSON). */
interface Envelope {
  /** `raw` = value stored inline; `gz` = serialized + compressed, base64. */
  k: 'raw' | 'gz'
  value?: unknown
  algo?: CompressionAlgo
  data?: string
  createdAt: number
  expiresAt?: number
  metadata: CacheMetadata
}

export interface RedisAdapterOptions extends RedisConnectionOptions {
  /** Inject an existing client (or a compatible fake) instead of constructing one. */
  client?: RedisClient
  /** Key prefix isolating this cache's keys. Default `'nodellmcache:'`. */
  namespace?: string
  /** Default relative TTL (ms) applied when neither `set`'s ttl nor the entry carries one. */
  defaultTTL?: number
  /** Compression mode. `false`/`'none'` (default) stores values inline as JSON. */
  compression?: false | CompressionAlgo
  /** Compression engine; lazily imported from `@nodellmcache/compression` if omitted. */
  compressionEngine?: CompressionEngine
  /** Serializer used when compression is enabled. Defaults to JSON. */
  serializer?: Serializer
}

const DEFAULT_NAMESPACE = 'nodellmcache:'
const SCAN_COUNT = 200

/**
 * Redis-backed {@link StorageAdapter}. Stores each entry as a JSON envelope under
 * a namespaced key, uses Redis-native millisecond expiry (`PX`) for TTL, and
 * optionally compresses values. Supports standalone, URL, Sentinel, and Cluster
 * connections (via `ioredis`) or an injected client.
 */
export class RedisAdapter<T = unknown> implements StorageAdapter<T> {
  private readonly client: RedisClient
  private readonly namespace: string
  private readonly defaultTTL: number | undefined
  private readonly compression: false | CompressionAlgo
  private readonly serializer: Serializer

  private injectedEngine: CompressionEngine | undefined
  private enginePromise: Promise<CompressionEngine> | undefined

  constructor(options: RedisAdapterOptions = {}) {
    this.client = options.client ?? createRedisClient(options)
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE
    this.defaultTTL = options.defaultTTL
    this.compression =
      options.compression === undefined || options.compression === 'none'
        ? false
        : options.compression
    this.serializer = options.serializer ?? new JsonSerializer()
    this.injectedEngine = options.compressionEngine
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.client.get(this.nk(key))
    if (raw === null) return null
    const entry = await this.decode(key, raw)
    // Redis expires keys natively; this is a defensive guard for clock skew.
    if (TTLManager.isExpired(entry)) {
      await this.delete(key)
      return null
    }
    return entry
  }

  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    const payload = await this.encode(entry)
    const fullKey = this.nk(key)
    const px = this.resolveTTL(entry, ttl)
    if (px === undefined) {
      await this.client.set(fullKey, payload) // no expiry
    } else if (px > 0) {
      await this.client.set(fullKey, payload, 'PX', px)
    } else {
      // Already expired (a past expiresAt): don't persist it, and clear any
      // existing value so an overwrite-with-expired doesn't leave stale data.
      await this.client.del(fullKey)
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.nk(key))
  }

  async clear(): Promise<void> {
    for await (const keys of this.scanNamespace()) {
      if (keys.length > 0) await this.client.del(...keys)
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(this.nk(key))) === 1
  }

  async stats(): Promise<AdapterStats> {
    let entryCount = 0
    for await (const keys of this.scanNamespace()) entryCount += keys.length
    const info = await this.client.info()
    return {
      entryCount,
      sizeBytes: parseInfoNumber(info, 'used_memory'),
      evictions: parseInfoNumber(info, 'evicted_keys'),
    }
  }

  /** Returns true if the server responds to PING. */
  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG'
  }

  /** Closes the connection. */
  async disconnect(): Promise<void> {
    await this.client.quit()
  }

  // --- internals -----------------------------------------------------------

  private nk(key: string): string {
    return this.namespace + key
  }

  /**
   * Resolves the PX ttl in milliseconds: a positive explicit arg wins, else the
   * time remaining from `entry.expiresAt`, else the adapter `defaultTTL`.
   * Returns `undefined` for "no expiry" and may return `<= 0` for an entry whose
   * `expiresAt` is already in the past (handled as a non-write by `set`).
   */
  private resolveTTL(entry: CacheEntry<T>, ttl?: number): number | undefined {
    if (ttl !== undefined && ttl > 0) return ttl
    if (entry.expiresAt !== undefined) return entry.expiresAt - Date.now()
    return this.defaultTTL
  }

  private async *scanNamespace(): AsyncGenerator<string[]> {
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${this.namespace}*`,
        'COUNT',
        SCAN_COUNT,
      )
      cursor = next
      yield keys
    } while (cursor !== '0')
  }

  private async encode(entry: CacheEntry<T>): Promise<string> {
    const base = { createdAt: entry.createdAt, expiresAt: entry.expiresAt, metadata: entry.metadata }
    if (this.compression === false) {
      return JSON.stringify({ k: 'raw', value: entry.value, ...base } satisfies Envelope)
    }
    const engine = await this.getEngine()
    const serialized = this.serializer.serialize(entry.value)
    const hint: DataHint | undefined =
      entry.metadata.cacheType === 'embedding' ? 'embedding' : undefined
    let algo: CompressionAlgo
    let data: Buffer
    if (this.compression === 'auto') {
      const result = await engine.auto(serialized, hint)
      algo = result.algo
      data = result.data
    } else {
      algo = this.compression
      data = await engine.compress(serialized, algo)
    }
    return JSON.stringify({ k: 'gz', algo, data: data.toString('base64'), ...base } satisfies Envelope)
  }

  private async decode(key: string, raw: string): Promise<CacheEntry<T>> {
    const env = JSON.parse(raw) as Envelope
    let value: T
    if (env.k === 'raw') {
      value = env.value as T
    } else {
      const engine = await this.getEngine()
      const buf = Buffer.from(env.data ?? '', 'base64')
      const decompressed = await engine.decompress(buf, env.algo ?? 'none')
      value = this.serializer.deserialize<T>(decompressed)
    }
    return {
      key,
      value,
      createdAt: env.createdAt,
      expiresAt: env.expiresAt,
      metadata: env.metadata,
    }
  }

  private async getEngine(): Promise<CompressionEngine> {
    if (this.injectedEngine) return this.injectedEngine
    this.enginePromise ??= import('@nodellmcache/compression')
      .then((mod) => new mod.CompressionEngine())
      .catch((cause) => {
        throw new NodeLLMCacheError(
          'Compression is enabled but @nodellmcache/compression is not installed. ' +
            'Install it, or pass a compressionEngine to RedisAdapter.',
          { cause },
        )
      })
    return this.enginePromise
  }
}

/** Extracts a numeric field (e.g. `used_memory:123`) from a Redis INFO dump. */
function parseInfoNumber(info: string, field: string): number | undefined {
  const match = info.match(new RegExp(`^${field}:(\\d+)`, 'm'))
  return match ? Number(match[1]) : undefined
}
