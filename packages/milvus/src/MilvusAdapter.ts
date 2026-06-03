import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createMilvusStore, type MilvusConnectionOptions } from './client.js'
import type { MilvusStore } from './MilvusStore.js'

export interface MilvusAdapterOptions extends MilvusConnectionOptions {
  /** Inject an existing store (or a compatible fake) instead of connecting. */
  store?: MilvusStore
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

/**
 * [Milvus](https://milvus.io) {@link VectorStoreAdapter}. Uses native string ids
 * (VarChar primary key) and a JSON `metadata` field, and queries with the
 * **cosine** metric so `score` is cosine similarity. The collection is created
 * on demand. Plugs into `@nodellmcache/semantic-cache`.
 *
 * `@zilliz/milvus2-sdk-node` is an optional peer dependency, lazily imported when
 * a store isn't injected.
 */
export class MilvusAdapter<M = Record<string, unknown>> implements VectorStoreAdapter<M> {
  private readonly makeStore: () => Promise<MilvusStore>
  private readonly maxRetries: number
  private storePromise: Promise<MilvusStore> | undefined

  constructor(options: MilvusAdapterOptions) {
    this.maxRetries = options.maxRetries ?? 3
    const injected = options.store
    this.makeStore = injected ? () => Promise.resolve(injected) : () => createMilvusStore(options)
  }

  /** Connects on first use; a failed connection is not cached, so it can retry. */
  private store(): Promise<MilvusStore> {
    if (!this.storePromise) {
      this.storePromise = this.makeStore()
      this.storePromise.catch(() => {
        this.storePromise = undefined
      })
    }
    return this.storePromise
  }

  async upsert(id: string, vector: number[], metadata?: M): Promise<void> {
    const store = await this.store()
    await this.retry(() => store.upsert(id, vector, (metadata ?? {}) as Record<string, unknown>))
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    const store = await this.store()
    const rows = await this.retry(() =>
      store.query(vector, topK, filter as Record<string, unknown> | undefined),
    )
    return rows.map((row) => ({ id: row.id, score: row.score, metadata: row.metadata as M }))
  }

  async delete(id: string): Promise<void> {
    const store = await this.store()
    await this.retry(() => store.deleteById(id))
  }

  /** Closes the underlying connection. */
  async disconnect(): Promise<void> {
    const store = await this.store()
    await store.close()
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
