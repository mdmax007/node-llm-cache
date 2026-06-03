import { NodeLLMCacheError } from '@nodellmcache/core'
import type { MilvusRow, MilvusStore } from './MilvusStore.js'

/** Connection options for Milvus. */
export interface MilvusConnectionOptions {
  /** Endpoint, e.g. `localhost:19530` or a Zilliz Cloud URI. */
  address?: string
  token?: string
  username?: string
  password?: string
  ssl?: boolean
  /** Collection name. */
  collection: string
  /** Vector dimensionality. If omitted, inferred from the first upserted vector. */
  vectorSize?: number
}

// Local typings for the optional, lazily-imported SDK — avoids a shipped
// `declare module` that could clash with the real package's types.
interface MilvusClientLike {
  hasCollection(p: { collection_name: string }): Promise<{ value: boolean }>
  createCollection(p: { collection_name: string; fields: Array<Record<string, unknown>> }): Promise<unknown>
  createIndex(p: { collection_name: string; field_name: string; index_type: string; metric_type: string }): Promise<unknown>
  loadCollection(p: { collection_name: string }): Promise<unknown>
  upsert(p: { collection_name: string; data: Array<Record<string, unknown>> }): Promise<unknown>
  search(p: {
    collection_name: string
    data: number[][]
    limit: number
    output_fields?: string[]
    filter?: string
  }): Promise<{ results?: Array<Record<string, unknown>> }>
  delete(p: { collection_name: string; filter: string }): Promise<unknown>
  closeConnection?(): void
}
interface MilvusSdk {
  MilvusClient: new (config: {
    address: string
    token?: string
    username?: string
    password?: string
    ssl?: boolean
  }) => MilvusClientLike
  DataType: Record<string, number>
  MetricType: Record<string, string>
}

/**
 * Builds a {@link MilvusStore} backed by the real, lazily-imported
 * `@zilliz/milvus2-sdk-node`. Excluded from unit coverage; exercised by the
 * env-guarded integration suite (a running Milvus is required).
 */
export async function createMilvusStore(options: MilvusConnectionOptions): Promise<MilvusStore> {
  const moduleId: string = '@zilliz/milvus2-sdk-node'
  let sdk: MilvusSdk
  try {
    sdk = (await import(moduleId)) as unknown as MilvusSdk
  } catch (cause) {
    throw new NodeLLMCacheError(
      '@nodellmcache/milvus requires @zilliz/milvus2-sdk-node to be installed, ' +
        'or inject your own MilvusStore.',
      { cause },
    )
  }

  const { MilvusClient, DataType, MetricType } = sdk
  const client = new MilvusClient({
    address: options.address ?? 'localhost:19530',
    token: options.token,
    username: options.username,
    password: options.password,
    ssl: options.ssl,
  })
  const collection_name = options.collection
  let ensured = false

  const ensure = async (dim: number): Promise<void> => {
    if (ensured) return
    const has = await client.hasCollection({ collection_name })
    if (!has.value) {
      await client.createCollection({
        collection_name,
        fields: [
          { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 512 },
          { name: 'vector', data_type: DataType.FloatVector, dim: options.vectorSize ?? dim },
          { name: 'metadata', data_type: DataType.JSON },
        ],
      })
      await client.createIndex({
        collection_name,
        field_name: 'vector',
        index_type: 'AUTOINDEX',
        metric_type: MetricType.COSINE!,
      })
    }
    await client.loadCollection({ collection_name })
    ensured = true
  }

  return {
    async upsert(id, vector, metadata) {
      await ensure(vector.length)
      await client.upsert({ collection_name, data: [{ id, vector, metadata }] })
    },
    async query(vector, limit, filter): Promise<MilvusRow[]> {
      await ensure(vector.length)
      const expr = buildExpr(filter)
      const res = await client.search({
        collection_name,
        data: [vector],
        limit,
        output_fields: ['id', 'metadata'],
        ...(expr ? { filter: expr } : {}),
      })
      return (res.results ?? []).map((row) => ({
        id: String(row.id),
        score: Number(row.score),
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }))
    },
    async deleteById(id) {
      await client.delete({ collection_name, filter: `id in ["${id}"]` })
    },
    async close() {
      client.closeConnection?.()
    },
  }
}

/** Builds a Milvus boolean expression from a flat equality filter over the JSON `metadata` field. */
export function buildExpr(filter?: Record<string, unknown>): string | undefined {
  if (!filter) return undefined
  const entries = Object.entries(filter)
  if (entries.length === 0) return undefined
  return entries
    .map(([key, value]) =>
      typeof value === 'string' ? `metadata["${key}"] == "${value}"` : `metadata["${key}"] == ${String(value)}`,
    )
    .join(' and ')
}
