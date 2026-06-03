/** A scored point returned by a Qdrant search. */
export interface QdrantScoredPoint {
  id: string | number
  score: number
  payload?: Record<string, unknown> | null
  vector?: number[] | Record<string, unknown> | null
}

/**
 * The minimal Qdrant command surface {@link QdrantAdapter} depends on. The real
 * `@qdrant/js-client-rest` `QdrantClient` satisfies this; tests inject an
 * in-memory fake so the adapter is testable without a running Qdrant.
 */
export interface QdrantClient {
  getCollections(): Promise<{ collections: { name: string }[] }>
  createCollection(
    name: string,
    config: { vectors: { size: number; distance: string } },
  ): Promise<unknown>
  upsert(
    name: string,
    params: {
      wait?: boolean
      points: { id: string | number; vector: number[]; payload?: Record<string, unknown> }[]
    },
  ): Promise<unknown>
  search(
    name: string,
    params: {
      vector: number[]
      limit: number
      filter?: unknown
      with_payload?: boolean
      with_vector?: boolean
    },
  ): Promise<QdrantScoredPoint[]>
  delete(name: string, params: { wait?: boolean; points: (string | number)[] }): Promise<unknown>
}
