import weaviate, { Filters, type FilterValue } from 'weaviate-client'
import type { WeaviateRow, WeaviateStore } from './WeaviateStore.js'

/** Connection options for a local Weaviate instance. */
export interface WeaviateConnectionOptions {
  host?: string
  port?: number
  grpcPort?: number
  /** Collection (class) name. */
  collection: string
}

/**
 * Builds a {@link WeaviateStore} backed by the real `weaviate-client` (v3),
 * connecting to a local instance and ensuring the collection exists with
 * self-provided vectors. Excluded from unit coverage; exercised by the
 * Docker-guarded integration suite.
 */
export async function createWeaviateStore(options: WeaviateConnectionOptions): Promise<WeaviateStore> {
  const client = await weaviate.connectToLocal({
    host: options.host ?? 'localhost',
    port: options.port ?? 8080,
    grpcPort: options.grpcPort ?? 50051,
  })

  const name = options.collection
  if (!(await client.collections.exists(name))) {
    await client.collections.create({ name, vectorizers: weaviate.configure.vectorizer.selfProvided() })
  }
  const col = client.collections.use(name)

  const buildFilters = (filter?: Record<string, unknown>): FilterValue | undefined => {
    if (!filter) return undefined
    const entries = Object.entries(filter)
    if (entries.length === 0) return undefined
    const conditions = entries.map(([key, value]) =>
      col.filter.byProperty(key).equal(value as never),
    )
    return conditions.length === 1 ? conditions[0] : Filters.and(...conditions)
  }

  return {
    async upsert(uuid, vector, properties) {
      // Replace semantics: remove any existing object at this id, then insert.
      await col.data.deleteById(uuid).catch(() => undefined)
      // reason: metadata is arbitrary user data; the SDK types properties as a
      // map of WeaviateField, so we cast at the boundary.
      await col.data.insert({ id: uuid, vectors: vector, properties: properties as never })
    },
    async query(vector, limit, filter): Promise<WeaviateRow[]> {
      const filters = buildFilters(filter)
      const res = await col.query.nearVector(vector, {
        limit,
        returnMetadata: ['distance'],
        ...(filters ? { filters } : {}),
      })
      return res.objects.map((o) => ({
        uuid: String(o.uuid),
        distance: o.metadata?.distance,
        properties: o.properties as Record<string, unknown>,
      }))
    },
    async deleteById(uuid) {
      await col.data.deleteById(uuid)
    },
    async close() {
      await client.close()
    },
  }
}
