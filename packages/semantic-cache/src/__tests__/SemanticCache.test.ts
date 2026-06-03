import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SemanticCache } from '../SemanticCache.js'
import { MemoryAdapter } from '@nodellmcache/memory'
import type { MetricEvent, VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'

// Deterministic mock embeddings. The "kubernetes" pair sits at cosine ~0.94 —
// above the 0.92 default and a 0.90 threshold, but below 0.99 — so threshold
// behavior is actually exercised. "pasta" is orthogonal (cosine 0).
const embeddings: Record<string, number[]> = {
  'what is kubernetes': [1, 0],
  'explain kubernetes': [0.94, 0.34],
  'how to cook pasta': [0, 1],
}

const mockEmbeddingFn = vi.fn((text: string) =>
  Promise.resolve(embeddings[text.toLowerCase().trim()] ?? [0, 0]),
)

describe('SemanticCache', () => {
  let cache: SemanticCache<string>
  let generator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockEmbeddingFn.mockClear()
    cache = new SemanticCache<string>({
      similarityThreshold: 0.9,
      embeddingFn: mockEmbeddingFn,
      adapter: new MemoryAdapter<string>(),
    })
    generator = vi.fn().mockResolvedValue('cached response')
  })

  it('misses on an empty cache', async () => {
    const result = await cache.getOrGenerate('what is kubernetes', generator)
    expect(generator).toHaveBeenCalledOnce()
    expect(result.fromCache).toBe(false)
    expect(result.value).toBe('cached response')
  })

  it('hits on a semantically similar query', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    const result = await cache.getOrGenerate('explain kubernetes', generator)
    expect(generator).toHaveBeenCalledOnce()
    expect(result.fromCache).toBe(true)
    expect(result.similarity).toBeGreaterThan(0.9)
  })

  it('misses on a dissimilar query', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('how to cook pasta', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('respects the similarity threshold', async () => {
    cache = new SemanticCache<string>({
      similarityThreshold: 0.99,
      embeddingFn: mockEmbeddingFn,
      adapter: new MemoryAdapter<string>(),
    })
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('explain kubernetes', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('returns the matched query on a hit', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    const result = await cache.getOrGenerate('explain kubernetes', generator)
    expect(result.matchedQuery).toBe('what is kubernetes')
  })

  it('treats an exact repeat as a hit (similarity ~1)', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    const result = await cache.getOrGenerate('what is kubernetes', generator)
    expect(result.fromCache).toBe(true)
    expect(result.similarity).toBeCloseTo(1, 5)
  })

  it('defaults the threshold to 0.92', async () => {
    cache = new SemanticCache<string>({ embeddingFn: mockEmbeddingFn, adapter: new MemoryAdapter<string>() })
    await cache.getOrGenerate('what is kubernetes', generator)
    const result = await cache.getOrGenerate('explain kubernetes', generator) // ~0.94 >= 0.92
    expect(result.fromCache).toBe(true)
  })

  // --- semantic vs exact accounting ---------------------------------------

  it('counts a different-query hit as a semantic hit', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('explain kubernetes', generator)
    const stats = await cache.stats()
    expect(stats.semanticHits).toBe(1)
    expect(stats.semanticHitRate).toBeCloseTo(0.5)
  })

  it('does not count an exact repeat as a semantic hit', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('what is kubernetes', generator)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.semanticHits).toBe(0)
  })

  it('reports hit/miss/entry stats', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('explain kubernetes', generator)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(0.5)
    expect(stats.entryCount).toBe(1)
  })

  it('reports zero rates before any access', async () => {
    const stats = await cache.stats()
    expect(stats.hitRate).toBe(0)
    expect(stats.semanticHitRate).toBe(0)
  })

  it('passes provider/model/ttl options through the lookup pipeline', async () => {
    vi.useFakeTimers()
    const opts = { provider: 'openai' as const, model: 'gpt-4o', ttl: 1000 }
    const first = await cache.getOrGenerate('what is kubernetes', generator, opts)
    expect(first.fromCache).toBe(false)
    const hit = await cache.getOrGenerate('what is kubernetes', generator, opts)
    expect(hit.fromCache).toBe(true)
    vi.advanceTimersByTime(1500) // per-call ttl expires the stored response
    const afterExpiry = await cache.getOrGenerate('what is kubernetes', generator, opts)
    expect(afterExpiry.fromCache).toBe(false)
    vi.useRealTimers()
  })

  // --- TTL / staleness -----------------------------------------------------

  it('treats expired responses as a miss and drops the stale index entry', async () => {
    vi.useFakeTimers()
    cache = new SemanticCache<string>({
      similarityThreshold: 0.9,
      embeddingFn: mockEmbeddingFn,
      adapter: new MemoryAdapter<string>(),
      defaultTTL: 1000,
    })
    await cache.getOrGenerate('what is kubernetes', generator)
    vi.advanceTimersByTime(2000)
    const result = await cache.getOrGenerate('what is kubernetes', generator)
    expect(generator).toHaveBeenCalledTimes(2)
    expect(result.fromCache).toBe(false)
    expect((await cache.stats()).entryCount).toBe(1) // re-added once
    vi.useRealTimers()
  })

  // --- lifecycle / metrics -------------------------------------------------

  it('clear() empties responses and the index', async () => {
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.clear()
    expect((await cache.stats()).entryCount).toBe(0)
    await cache.getOrGenerate('what is kubernetes', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('emits hit, miss, and set metrics', async () => {
    const events: MetricEvent[] = []
    cache = new SemanticCache<string>({
      similarityThreshold: 0.9,
      embeddingFn: mockEmbeddingFn,
      adapter: new MemoryAdapter<string>(),
      metrics: { emit: (e) => events.push(e) },
    })
    await cache.getOrGenerate('what is kubernetes', generator)
    await cache.getOrGenerate('explain kubernetes', generator)
    expect(events).toContain('cache.miss')
    expect(events).toContain('cache.set')
    expect(events).toContain('cache.hit')
  })

  // --- pluggable vector store ---------------------------------------------

  it('works with an injected VectorStoreAdapter', async () => {
    // Minimal in-memory cosine vector store.
    const store = new Map<string, { vector: number[]; meta: { query: string } }>()
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)
    const norm = (a: number[]) => Math.sqrt(dot(a, a))
    const vectorStore: VectorStoreAdapter<{ query: string }> = {
      async upsert(id, vector, meta) {
        store.set(id, { vector, meta: meta ?? { query: '' } })
      },
      async query(vector, topK): Promise<VectorMatch<{ query: string }>[]> {
        return [...store.entries()]
          .map(([id, e]) => ({
            id,
            score: norm(vector) && norm(e.vector) ? dot(vector, e.vector) / (norm(vector) * norm(e.vector)) : 0,
            metadata: e.meta,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
      },
      async delete(id) {
        store.delete(id)
      },
    }

    cache = new SemanticCache<string>({
      similarityThreshold: 0.9,
      embeddingFn: mockEmbeddingFn,
      adapter: new MemoryAdapter<string>(),
      vectorStore,
    })

    await cache.getOrGenerate('what is kubernetes', generator)
    const result = await cache.getOrGenerate('explain kubernetes', generator)
    expect(result.fromCache).toBe(true)
    expect(result.matchedQuery).toBe('what is kubernetes')
    expect(store.size).toBe(1)
  })
})
