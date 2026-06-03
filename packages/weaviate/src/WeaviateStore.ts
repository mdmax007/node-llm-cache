import { createHash } from 'node:crypto'

/** A row returned by a Weaviate nearVector query. */
export interface WeaviateRow {
  uuid: string
  distance: number | undefined
  properties: Record<string, unknown>
}

/**
 * Minimal Weaviate operations {@link WeaviateAdapter} depends on. The real
 * client implementation lives in `client.ts`; tests inject an in-memory fake.
 * (Weaviate's v3 client API is builder-shaped, so the adapter targets this small
 * surface rather than the SDK directly.)
 */
export interface WeaviateStore {
  upsert(uuid: string, vector: number[], properties: Record<string, unknown>): Promise<void>
  query(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<WeaviateRow[]>
  deleteById(uuid: string): Promise<void>
  close(): Promise<void>
}

/**
 * Maps an arbitrary string id to a deterministic, RFC-4122-shaped (v4) UUID, as
 * Weaviate requires UUID object ids. Same string → same UUID.
 */
export function toUuid(id: string): string {
  const h = createHash('sha256').update(id).digest('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
