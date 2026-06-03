import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetrievalCache, type RetrievedDocument } from '../RetrievalCache.js'
import { MemoryAdapter } from '@nodellmcache/memory'

const docs = (...ids: string[]): RetrievedDocument[] =>
  ids.map((id, i) => ({ id, score: 1 - i * 0.1, content: `doc ${id}` }))

describe('RetrievalCache', () => {
  let cache: RetrievalCache
  let generator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cache = new RetrievalCache({ adapter: new MemoryAdapter<RetrievedDocument[]>() })
    generator = vi.fn().mockResolvedValue(docs('a', 'b', 'c'))
  })

  it('caches retrieval results by query', async () => {
    const r1 = await cache.getOrGenerate('find cats', generator)
    const r2 = await cache.getOrGenerate('find cats', generator)
    expect(generator).toHaveBeenCalledOnce()
    expect(r2).toEqual(r1)
  })

  it('treats normalized queries as the same key', async () => {
    await cache.getOrGenerate('Find  Cats', generator)
    await cache.getOrGenerate('find cats', generator)
    expect(generator).toHaveBeenCalledOnce()
  })

  it('caches reranker output keyed by query + input doc set', async () => {
    const rerank = vi.fn().mockResolvedValue(docs('b', 'a'))
    await cache.getOrRerank('q', docs('a', 'b'), rerank)
    await cache.getOrRerank('q', docs('a', 'b'), rerank)
    expect(rerank).toHaveBeenCalledOnce()
  })

  it('rerank key is order-independent over the input set', async () => {
    const rerank = vi.fn().mockResolvedValue(docs('b', 'a'))
    await cache.getOrRerank('q', docs('a', 'b'), rerank)
    await cache.getOrRerank('q', docs('b', 'a'), rerank) // same set, different order
    expect(rerank).toHaveBeenCalledOnce()
  })

  it('rerank distinguishes different input doc sets', async () => {
    const rerank = vi.fn().mockResolvedValue(docs('a'))
    await cache.getOrRerank('q', docs('a', 'b'), rerank)
    await cache.getOrRerank('q', docs('a', 'c'), rerank)
    expect(rerank).toHaveBeenCalledTimes(2)
  })

  it('a rerank does not collide with a plain retrieval of the same query', async () => {
    await cache.getOrGenerate('q', generator)
    const rerank = vi.fn().mockResolvedValue(docs('a'))
    await cache.getOrRerank('q', docs('a'), rerank)
    expect(generator).toHaveBeenCalledOnce()
    expect(rerank).toHaveBeenCalledOnce()
  })

  describe('invalidateByDocument', () => {
    it('evicts entries whose results contain the document', async () => {
      await cache.getOrGenerate('q1', () => Promise.resolve(docs('a', 'b')))
      await cache.getOrGenerate('q2', () => Promise.resolve(docs('b', 'c')))
      await cache.getOrGenerate('q3', () => Promise.resolve(docs('x', 'y')))

      const removed = await cache.invalidateByDocument('b') // in q1 and q2
      expect(removed).toBe(2)

      // q1 and q2 regenerate; q3 still cached.
      const g = vi.fn().mockResolvedValue(docs('a', 'b'))
      await cache.getOrGenerate('q1', g)
      await cache.getOrGenerate('q3', g)
      expect(g).toHaveBeenCalledOnce() // only q1 missed
    })

    it('returns 0 for an unknown document', async () => {
      expect(await cache.invalidateByDocument('nope')).toBe(0)
    })

    it('invalidates rerank entries too', async () => {
      const rerank = vi.fn().mockResolvedValue(docs('a', 'b'))
      await cache.getOrRerank('q', docs('a', 'b'), rerank)
      const removed = await cache.invalidateByDocument('a')
      expect(removed).toBe(1)
      await cache.getOrRerank('q', docs('a', 'b'), rerank)
      expect(rerank).toHaveBeenCalledTimes(2)
    })
  })

  it('respects TTL freshness', async () => {
    vi.useFakeTimers()
    cache = new RetrievalCache({
      adapter: new MemoryAdapter<RetrievedDocument[]>(),
      defaultTTL: 1000,
    })
    await cache.getOrGenerate('q', generator)
    vi.advanceTimersByTime(2000)
    await cache.getOrGenerate('q', generator)
    expect(generator).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('tracks hit/miss stats', async () => {
    await cache.getOrGenerate('q', generator)
    await cache.getOrGenerate('q', generator)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('supports a custom document type', async () => {
    interface Doc { id: string; title: string }
    const typed = new RetrievalCache<Doc>({ adapter: new MemoryAdapter<Doc[]>() })
    const gen = vi.fn().mockResolvedValue([{ id: '1', title: 'hi' }])
    const result = await typed.getOrGenerate('q', gen)
    expect(result[0]?.title).toBe('hi')
  })
})
