import type { VectorStoreAdapter } from '@nodellmcache/core'
import { cosineSimilarity } from './cosineSimilarity.js'

/** A nearest-neighbour match returned by a {@link VectorIndex}. */
export interface IndexMatch {
  /** Storage key of the matched entry. */
  id: string
  /** The original query text stored alongside the vector. */
  query: string
  /** Cosine similarity to the search vector, in `[-1, 1]`. */
  similarity: number
}

/**
 * Abstraction over the similarity-search backend used by `SemanticCache`.
 * The default is an in-memory brute-force scan; large deployments can plug in
 * a real vector database via {@link VectorStoreIndex}.
 */
export interface VectorIndex {
  add(id: string, vector: number[], query: string): Promise<void>
  /** Returns the single best match across the index, or `null` if empty. */
  search(vector: number[]): Promise<IndexMatch | null>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  size(): number
}

/**
 * In-memory brute-force index. O(n) per search — suitable for up to ~10k
 * entries. Beyond that, use a {@link VectorStoreIndex}.
 */
export class InMemoryVectorIndex implements VectorIndex {
  private readonly entries = new Map<string, { vector: number[]; query: string }>()

  async add(id: string, vector: number[], query: string): Promise<void> {
    this.entries.set(id, { vector, query })
  }

  async search(vector: number[]): Promise<IndexMatch | null> {
    let best: IndexMatch | null = null
    for (const [id, entry] of this.entries) {
      const similarity = cosineSimilarity(vector, entry.vector)
      if (best === null || similarity > best.similarity) {
        best = { id, query: entry.query, similarity }
      }
    }
    return best
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async clear(): Promise<void> {
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }
}

/** Metadata persisted with each vector so matches can report the original query. */
export interface QueryMeta {
  query: string
}

/**
 * Index backed by a pluggable {@link VectorStoreAdapter} (Qdrant, pgvector, …).
 * The store is expected to return **cosine similarity** as the match `score`.
 */
export class VectorStoreIndex implements VectorIndex {
  private count = 0

  constructor(private readonly store: VectorStoreAdapter<QueryMeta>) {}

  async add(id: string, vector: number[], query: string): Promise<void> {
    await this.store.upsert(id, vector, { query })
    this.count++
  }

  async search(vector: number[]): Promise<IndexMatch | null> {
    const matches = await this.store.query(vector, 1)
    const top = matches[0]
    if (!top) return null
    return { id: top.id, query: top.metadata?.query ?? '', similarity: top.score }
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id)
    this.count = Math.max(0, this.count - 1)
  }

  async clear(): Promise<void> {
    // The VectorStoreAdapter contract has no bulk clear; callers manage lifecycle.
  }

  size(): number {
    return this.count
  }
}
