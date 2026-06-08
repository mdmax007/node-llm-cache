import type { CacheType, CompressionAlgo, DataHint, LLMProvider } from './types.js'

/**
 * Metadata stored alongside every cache entry. Captures how the value was
 * encoded and which LLM workload produced it.
 */
export interface CacheMetadata {
  compressed: boolean
  compressionAlgo?: CompressionAlgo
  originalSize: number
  compressedSize?: number
  cacheType: CacheType
  provider?: LLMProvider
  model?: string
  tokenCount?: number
  /**
   * Absolute epoch ms after which the entry is considered *stale* but still
   * usable. Used by stale-while-revalidate: a stale hit is served immediately
   * while a fresh value is fetched in the background. Always earlier than
   * `expiresAt`.
   */
  staleAt?: number
}

/**
 * A single cached value with its bookkeeping. `expiresAt` is an absolute epoch
 * timestamp in milliseconds; when omitted the entry never expires.
 */
export interface CacheEntry<T> {
  key: string
  value: T
  createdAt: number
  expiresAt?: number
  metadata: CacheMetadata
}

/**
 * Aggregate statistics reported by a storage adapter.
 */
export interface AdapterStats {
  /** Number of entries currently held. */
  entryCount: number
  /** Approximate bytes used by stored entries, if the adapter can measure it. */
  sizeBytes?: number
  /** Number of evictions performed over the adapter's lifetime. */
  evictions?: number
}

/**
 * The contract every storage backend implements. Application code never
 * imports a concrete adapter in business logic — adapters are injected.
 */
export interface StorageAdapter<T = unknown> {
  get(key: string): Promise<CacheEntry<T> | null>
  /** `ttl` is a relative duration in milliseconds from now. */
  set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
  stats(): Promise<AdapterStats>
}

/**
 * Result of a single compression operation.
 */
export interface CompressedResult {
  data: Buffer
  algo: CompressionAlgo
  originalSize: number
  compressedSize: number
  ratio: number
  durationMs: number
}

/**
 * Statistics for a completed compression, suitable for observability rollups.
 */
export interface CompressionStats {
  originalSize: number
  compressedSize: number
  ratio: number
  savedBytes: number
  savedPercent: number
}

/**
 * The compression engine contract implemented by `@nodellmcache/compression`.
 */
export interface CompressionEngine {
  compress(data: Buffer, algo: CompressionAlgo): Promise<Buffer>
  decompress(data: Buffer, algo: CompressionAlgo): Promise<Buffer>
  auto(data: Buffer, hint?: DataHint): Promise<CompressedResult>
  stats(original: Buffer, compressed: Buffer): CompressionStats
}

/**
 * A vector match returned by a vector store query.
 */
export interface VectorMatch<M = Record<string, unknown>> {
  id: string
  score: number
  vector?: number[]
  metadata?: M
}

/**
 * The contract every vector database adapter implements.
 */
export interface VectorStoreAdapter<M = Record<string, unknown>> {
  upsert(id: string, vector: number[], metadata?: M): Promise<void>
  query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]>
  delete(id: string): Promise<void>
}

/**
 * The names of metric events emitted by cache managers.
 */
export type MetricEvent = 'cache.hit' | 'cache.miss' | 'cache.set' | 'cache.evict'

/**
 * Payload accompanying a metric event.
 */
export interface MetricData {
  cacheType: CacheType
  latencyMs: number
  tokensSaved?: number
  estimatedCostUSD?: number
  provider?: LLMProvider
  model?: string
}

/**
 * A sink for cache metrics. `@nodellmcache/observability` provides the real
 * implementation; core ships a no-op so it stays dependency-free.
 */
export interface MetricsSink {
  emit(event: MetricEvent, data: MetricData): void
}

/**
 * Per-call options shared across cache managers.
 */
export interface CacheOptions {
  provider?: LLMProvider
  model?: string
  /** Relative TTL in milliseconds; overrides the manager default. */
  ttl?: number
  /**
   * Relative ms after which an entry is *stale* but still servable via
   * `getOrRevalidate` (stale-while-revalidate). Should be less than `ttl`.
   */
  staleTtl?: number
  /** When false, bypasses the cache entirely (read and write). */
  cache?: boolean
  tokenCount?: number
}

/**
 * Hit/miss statistics reported by a cache manager.
 */
export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  entryCount: number
}
