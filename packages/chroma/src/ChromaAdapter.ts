import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createChromaClient, type ChromaConnectionOptions } from './client.js'
import type { ChromaClient, ChromaCollection } from './ChromaClient.js'

/** Chroma HNSW distance space. `cosine` makes `score = 1 - distance` a cosine similarity. */
export type ChromaSpace = 'cosine' | 'l2' | 'ip'

export interface ChromaAdapterOptions extends ChromaConnectionOptions {
  /** Inject an existing client (or a compatible fake). */
  client?: ChromaClient
  /** Collection name. */
  collection: string
  /** Distance space for an auto-created collection. Default `cosine`. */
  space?: ChromaSpace
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

/**
 * [Chroma](https://www.trychroma.com) {@link VectorStoreAdapter}. Stores vectors
 * with arbitrary string ids (Chroma supports them natively) and metadata, and
 * queries by the collection's distance space, exposing `score = 1 - distance`
 * (cosine similarity for the default `cosine` space). Plugs into
 * `@nodellmcache/semantic-cache`.
 */
export class ChromaAdapter<M = Record<string, unknown>> implements VectorStoreAdapter<M> {
  private readonly client: ChromaClient
  private readonly collectionName: string
  private readonly space: ChromaSpace
  private readonly maxRetries: number
  private collectionPromise: Promise<ChromaCollection> | undefined

  constructor(options: ChromaAdapterOptions) {
    this.client = options.client ?? createChromaClient(options)
    this.collectionName = options.collection
    this.space = options.space ?? 'cosine'
    this.maxRetries = options.maxRetries ?? 3
  }

  async upsert(id: string, vector: number[], metadata?: M): Promise<void> {
    const collection = await this.getCollection()
    await this.retry(() =>
      collection.upsert({
        ids: [id],
        embeddings: [vector],
        metadatas: [(metadata ?? {}) as Record<string, unknown>],
      }),
    )
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    const collection = await this.getCollection()
    const where = toChromaWhere(filter as Record<string, unknown> | undefined)
    const result = await this.retry(() =>
      collection.query({
        queryEmbeddings: [vector],
        nResults: topK,
        ...(where ? { where } : {}),
      }),
    )

    const ids = result.ids[0] ?? []
    const distances = result.distances?.[0] ?? []
    const metadatas = result.metadatas?.[0] ?? []
    return ids.map((id, i) => {
      const distance = distances[i]
      return {
        id,
        score: typeof distance === 'number' ? 1 - distance : 0,
        metadata: (metadatas[i] ?? {}) as M,
      }
    })
  }

  async delete(id: string): Promise<void> {
    const collection = await this.getCollection()
    await this.retry(() => collection.delete({ ids: [id] }))
  }

  // --- internals -----------------------------------------------------------

  private getCollection(): Promise<ChromaCollection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.retry(() =>
        this.client.getOrCreateCollection({
          name: this.collectionName,
          metadata: { 'hnsw:space': this.space },
        }),
      )
      // Don't cache a rejection — a transient first-use failure must not poison
      // the adapter; clear it so a later call retries.
      this.collectionPromise.catch(() => {
        this.collectionPromise = undefined
      })
    }
    return this.collectionPromise
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

/**
 * Translates a flat equality filter into a Chroma `where` clause. Multiple keys
 * are combined with `$and`.
 */
export function toChromaWhere(filter?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!filter) return undefined
  const entries = Object.entries(filter)
  if (entries.length === 0) return undefined
  if (entries.length === 1) {
    const [key, value] = entries[0]!
    return { [key]: value }
  }
  return { $and: entries.map(([key, value]) => ({ [key]: value })) }
}
