/** A row returned by a Milvus search. */
export interface MilvusRow {
  id: string
  score: number
  metadata: Record<string, unknown>
}

/**
 * Minimal Milvus operations {@link MilvusAdapter} depends on. The real
 * implementation (lazily importing `@zilliz/milvus2-sdk-node`) lives in
 * `client.ts`; tests inject an in-memory fake.
 */
export interface MilvusStore {
  upsert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>
  query(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<MilvusRow[]>
  deleteById(id: string): Promise<void>
  close(): Promise<void>
}
