import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createWeaviateStore, type WeaviateConnectionOptions } from './client.js'
import { toUuid, type WeaviateStore } from './WeaviateStore.js'

export interface WeaviateAdapterOptions extends WeaviateConnectionOptions {
  /** Inject an existing store (or a compatible fake) instead of connecting. */
  store?: WeaviateStore
  /** Property key that round-trips the original (arbitrary string) id. Default `__id`. */
  idKey?: string
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

const DEFAULT_ID_KEY = '__id'

/**
 * [Weaviate](https://weaviate.io) {@link VectorStoreAdapter}. Arbitrary string
 * ids are mapped to deterministic UUIDs (Weaviate requires UUID object ids),
 * with the original preserved in object properties and restored on query.
 * Queries return cosine `score = 1 - distance`. Plugs into
 * `@nodellmcache/semantic-cache`.
 */
export class WeaviateAdapter<M = Record<string, unknown>> implements VectorStoreAdapter<M> {
  private readonly makeStore: () => Promise<WeaviateStore>
  private readonly idKey: string
  private readonly maxRetries: number
  private storePromise: Promise<WeaviateStore> | undefined

  constructor(options: WeaviateAdapterOptions) {
    this.idKey = options.idKey ?? DEFAULT_ID_KEY
    this.maxRetries = options.maxRetries ?? 3
    const injected = options.store
    this.makeStore = injected ? () => Promise.resolve(injected) : () => createWeaviateStore(options)
  }

  /** Connects on first use; a failed connection is not cached, so it can retry. */
  private store(): Promise<WeaviateStore> {
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
    const properties: Record<string, unknown> = {
      ...((metadata ?? {}) as Record<string, unknown>),
      [this.idKey]: id,
    }
    await this.retry(() => store.upsert(toUuid(id), vector, properties))
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    const store = await this.store()
    const rows = await this.retry(() =>
      store.query(vector, topK, filter as Record<string, unknown> | undefined),
    )
    return rows.map((row) => {
      const { [this.idKey]: originalId, ...metadata } = row.properties
      return {
        id: typeof originalId === 'string' ? originalId : row.uuid,
        score: typeof row.distance === 'number' ? 1 - row.distance : 0,
        metadata: metadata as M,
      }
    })
  }

  async delete(id: string): Promise<void> {
    const store = await this.store()
    await this.retry(() => store.deleteById(toUuid(id)))
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
