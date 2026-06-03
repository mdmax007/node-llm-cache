import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createPineconeIndex, type PineconeConnectionOptions } from './client.js'
import type { PineconeIndex } from './PineconeClient.js'

export interface PineconeAdapterOptions extends PineconeConnectionOptions {
  /** Inject an existing index handle (or a compatible fake) instead of constructing one. */
  client?: PineconeIndex
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

/**
 * [Pinecone](https://www.pinecone.io) {@link VectorStoreAdapter}. Targets an
 * existing index (create it out-of-band, with the **cosine** metric so `score`
 * is cosine similarity). Uses native string ids and flat `$eq` metadata filters.
 * Plugs into `@nodellmcache/semantic-cache`.
 */
export class PineconeAdapter<M = Record<string, unknown>> implements VectorStoreAdapter<M> {
  private readonly index: PineconeIndex
  private readonly maxRetries: number

  constructor(options: PineconeAdapterOptions) {
    this.index = options.client ?? createPineconeIndex(options)
    this.maxRetries = options.maxRetries ?? 3
  }

  async upsert(id: string, vector: number[], metadata?: M): Promise<void> {
    await this.retry(() =>
      this.index.upsert([
        { id, values: vector, metadata: (metadata ?? {}) as Record<string, unknown> },
      ]),
    )
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    const pineconeFilter = toPineconeFilter(filter as Record<string, unknown> | undefined)
    const { matches } = await this.retry(() =>
      this.index.query({
        vector,
        topK,
        includeMetadata: true,
        ...(pineconeFilter ? { filter: pineconeFilter } : {}),
      }),
    )
    return (matches ?? []).map((match) => ({
      id: match.id,
      score: match.score ?? 0,
      metadata: (match.metadata ?? {}) as M,
    }))
  }

  async delete(id: string): Promise<void> {
    await this.retry(() => this.index.deleteOne(id))
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

/** Translates a flat equality filter into Pinecone's `$eq` form (keys AND-ed). */
export function toPineconeFilter(
  filter?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!filter) return undefined
  const entries = Object.entries(filter)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries.map(([key, value]) => [key, { $eq: value }]))
}
