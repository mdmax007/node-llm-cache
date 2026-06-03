/** Result shape of a Chroma collection query (single query vector). */
export interface ChromaQueryResult {
  ids: string[][]
  distances?: (number[] | null)[] | null
  metadatas?: (Record<string, unknown> | null)[][] | null
}

/** Minimal Chroma collection surface used by the adapter. */
export interface ChromaCollection {
  upsert(params: {
    ids: string[]
    embeddings: number[][]
    metadatas?: Record<string, unknown>[]
  }): Promise<unknown>
  query(params: {
    queryEmbeddings: number[][]
    nResults: number
    where?: Record<string, unknown>
  }): Promise<ChromaQueryResult>
  delete(params: { ids: string[] }): Promise<unknown>
}

/**
 * Minimal Chroma client surface {@link ChromaAdapter} depends on. The real
 * `chromadb` `ChromaClient` satisfies this; tests inject an in-memory fake.
 */
export interface ChromaClient {
  getOrCreateCollection(params: {
    name: string
    metadata?: Record<string, unknown>
  }): Promise<ChromaCollection>
}
