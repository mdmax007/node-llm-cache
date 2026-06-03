/** A record to upsert into a Pinecone index. */
export interface PineconeRecord {
  id: string
  values: number[]
  metadata?: Record<string, unknown>
}

/** A scored match from a Pinecone query. */
export interface PineconeMatch {
  id: string
  score?: number
  metadata?: Record<string, unknown>
}

/**
 * Minimal Pinecone index surface {@link PineconeAdapter} depends on. The real
 * `@pinecone-database/pinecone` index satisfies this; tests inject a fake.
 */
export interface PineconeIndex {
  upsert(records: PineconeRecord[]): Promise<unknown>
  query(params: {
    vector: number[]
    topK: number
    includeMetadata?: boolean
    filter?: Record<string, unknown>
  }): Promise<{ matches?: PineconeMatch[] }>
  deleteOne(id: string): Promise<unknown>
}
