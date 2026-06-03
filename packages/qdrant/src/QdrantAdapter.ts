import { createHash } from 'node:crypto'
import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createQdrantClient, type QdrantConnectionOptions } from './client.js'
import type { QdrantClient } from './QdrantClient.js'

/** Distance metric for the Qdrant collection. `Cosine` makes `score` a cosine similarity. */
export type QdrantDistance = 'Cosine' | 'Dot' | 'Euclid'

export interface QdrantAdapterOptions extends QdrantConnectionOptions {
  /** Inject an existing client (or a compatible fake) instead of constructing one. */
  client?: QdrantClient
  /** Target collection name. */
  collection: string
  /** Vector dimensionality. If omitted, inferred from the first upserted vector. */
  vectorSize?: number
  /** Distance metric for auto-created collections. Default `Cosine`. */
  distance?: QdrantDistance
  /** Payload key used to round-trip the original (arbitrary string) id. Default `__id`. */
  idKey?: string
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

const DEFAULT_ID_KEY = '__id'

/**
 * Qdrant-backed {@link VectorStoreAdapter}. Plugs directly into
 * `@nodellmcache/semantic-cache` (as its `vectorStore`) or any code needing
 * vector upsert/query/delete.
 *
 * Arbitrary string ids are mapped to deterministic UUID point ids (Qdrant only
 * accepts integer/UUID ids); the original id is preserved in the payload and
 * restored on query. The collection is created on demand (cosine by default).
 */
export class QdrantAdapter<M extends Record<string, unknown> = Record<string, unknown>>
  implements VectorStoreAdapter<M>
{
  private readonly client: QdrantClient
  private readonly collection: string
  private readonly distance: QdrantDistance
  private readonly idKey: string
  private readonly maxRetries: number
  private vectorSize: number | undefined
  private ensured = false

  constructor(options: QdrantAdapterOptions) {
    this.client = options.client ?? createQdrantClient(options)
    this.collection = options.collection
    this.distance = options.distance ?? 'Cosine'
    this.idKey = options.idKey ?? DEFAULT_ID_KEY
    this.maxRetries = options.maxRetries ?? 3
    this.vectorSize = options.vectorSize
  }

  async upsert(id: string, vector: number[], metadata?: M): Promise<void> {
    await this.ensureCollection(vector.length)
    const payload: Record<string, unknown> = { ...(metadata ?? {}), [this.idKey]: id }
    await this.retry(() =>
      this.client.upsert(this.collection, {
        wait: true,
        points: [{ id: toPointId(id), vector, payload }],
      }),
    )
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    await this.ensureCollection(vector.length)
    const points = await this.retry(() =>
      this.client.search(this.collection, {
        vector,
        limit: topK,
        filter: toQdrantFilter(filter),
        with_payload: true,
      }),
    )
    return points.map((point) => {
      const payload = (point.payload ?? {}) as Record<string, unknown>
      const { [this.idKey]: originalId, ...metadata } = payload
      return {
        id: typeof originalId === 'string' ? originalId : String(point.id),
        score: point.score,
        metadata: metadata as M,
      }
    })
  }

  async delete(id: string): Promise<void> {
    await this.retry(() =>
      this.client.delete(this.collection, { wait: true, points: [toPointId(id)] }),
    )
  }

  // --- internals -----------------------------------------------------------

  /** Creates the collection on first use if it doesn't already exist. */
  private async ensureCollection(size: number): Promise<void> {
    if (this.ensured) return
    this.vectorSize ??= size
    const { collections } = await this.retry(() => this.client.getCollections())
    if (!collections.some((c) => c.name === this.collection)) {
      await this.retry(() =>
        this.client.createCollection(this.collection, {
          vectors: { size: this.vectorSize ?? size, distance: this.distance },
        }),
      )
    }
    this.ensured = true
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }
}

/** Maps an arbitrary string id to a deterministic UUID-shaped point id. */
function toPointId(id: string): string {
  const h = createHash('sha256').update(id).digest('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Translates a flat metadata filter into a Qdrant `must`-match filter. */
function toQdrantFilter(filter?: Record<string, unknown>): unknown {
  if (!filter) return undefined
  const must = Object.entries(filter).map(([key, value]) => ({ key, match: { value } }))
  return must.length > 0 ? { must } : undefined
}
