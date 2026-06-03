import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmbeddingCache } from '../EmbeddingCache.js'
import { MemoryAdapter } from '@nodellmcache/memory'
import { ValidationError } from '@nodellmcache/core'
import type { MetricEvent } from '@nodellmcache/core'

const mockEmbedding = (n: number): number[] => Array.from({ length: 8 }, (_, i) => i * n * 0.001)

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache
  let generator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cache = new EmbeddingCache({ adapter: new MemoryAdapter() })
    generator = vi.fn().mockImplementation(() => Promise.resolve(mockEmbedding(1)))
  })

  // --- single --------------------------------------------------------------

  it('caches a single embedding', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledOnce()
  })

  it('returns the correct embedding vector', async () => {
    const expected = mockEmbedding(1)
    generator.mockResolvedValue(expected)
    const result = await cache.getOrGenerate('hello', generator)
    expect(result).toEqual(expected)
  })

  it('differentiates by model', async () => {
    await cache.getOrGenerate('hello', generator, { model: 'text-embedding-3-small' })
    await cache.getOrGenerate('hello', generator, { model: 'text-embedding-3-large' })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('differentiates by dimensions', async () => {
    await cache.getOrGenerate('hello', generator, { model: 'm', dimensions: 256 })
    await cache.getOrGenerate('hello', generator, { model: 'm', dimensions: 1536 })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  // --- batch (architecture spec) ------------------------------------------

  it('getBatch only calls generator for uncached texts', async () => {
    const batchGenerator = vi
      .fn()
      .mockImplementation((texts: string[]) => Promise.resolve(texts.map((_, i) => mockEmbedding(i + 1))))

    await cache.getBatch(['a', 'b', 'c'], batchGenerator)
    expect(batchGenerator).toHaveBeenCalledWith(['a', 'b', 'c'])

    await cache.getBatch(['a', 'b', 'c'], batchGenerator)
    expect(batchGenerator).toHaveBeenCalledOnce()
  })

  it('getBatch deduplicates repeated inputs before calling generator', async () => {
    const batchGenerator = vi
      .fn()
      .mockImplementation((texts: string[]) => Promise.resolve(texts.map((_, i) => mockEmbedding(i))))
    await cache.getBatch(['dog', 'cat', 'dog', 'bird', 'cat'], batchGenerator)
    expect(batchGenerator).toHaveBeenCalledWith(['dog', 'cat', 'bird'])
  })

  it('getBatch returns results in input order', async () => {
    const batchGenerator = vi
      .fn()
      .mockImplementation((texts: string[]) => Promise.resolve(texts.map((_, i) => mockEmbedding(i))))
    const results = await cache.getBatch(['a', 'b', 'c'], batchGenerator)
    expect(results).toHaveLength(3)
  })

  it('getBatch maps duplicate inputs to the same embedding in order', async () => {
    const byText: Record<string, number[]> = { dog: mockEmbedding(1), cat: mockEmbedding(2), bird: mockEmbedding(3) }
    const batchGenerator = vi
      .fn()
      .mockImplementation((texts: string[]) => Promise.resolve(texts.map((t) => byText[t]!)))
    const results = await cache.getBatch(['dog', 'cat', 'dog', 'bird', 'cat'], batchGenerator)
    expect(results).toEqual([byText.dog, byText.cat, byText.dog, byText.bird, byText.cat])
  })

  it('getBatch mixes cached and uncached, preserving order', async () => {
    const byText: Record<string, number[]> = { a: mockEmbedding(1), b: mockEmbedding(2), c: mockEmbedding(3) }
    const gen = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map((t) => byText[t]!)))
    await cache.getBatch(['a'], gen) // prime 'a'
    gen.mockClear()
    const results = await cache.getBatch(['a', 'b', 'c'], gen)
    expect(gen).toHaveBeenCalledWith(['b', 'c']) // only uncached
    expect(results).toEqual([byText.a, byText.b, byText.c])
  })

  it('getBatch returns [] for empty input without calling the generator', async () => {
    const gen = vi.fn()
    expect(await cache.getBatch([], gen)).toEqual([])
    expect(gen).not.toHaveBeenCalled()
  })

  it('throws when the generator returns the wrong number of vectors', async () => {
    const gen = vi.fn().mockResolvedValue([mockEmbedding(1)]) // 1 vector for 2 inputs
    await expect(cache.getBatch(['a', 'b'], gen)).rejects.toThrow(ValidationError)
  })

  // --- stats ---------------------------------------------------------------

  it('tracks embeddingsReused and apiCallsAvoided', async () => {
    const gen = vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map((_, i) => mockEmbedding(i))))
    // First batch: 5 items, 3 generated (2 dups collapsed).
    await cache.getBatch(['dog', 'cat', 'dog', 'bird', 'cat'], gen)
    let stats = await cache.stats()
    expect(stats.embeddingsReused).toBe(0)
    expect(stats.apiCallsAvoided).toBe(2) // 5 requested - 3 generated

    // Second identical batch: all 5 served from cache.
    await cache.getBatch(['dog', 'cat', 'dog', 'bird', 'cat'], gen)
    stats = await cache.stats()
    expect(stats.embeddingsReused).toBe(5)
    expect(stats.apiCallsAvoided).toBe(7) // 10 requested - 3 generated
    expect(stats.hitRate).toBeCloseTo(0.5)
    expect(stats.entryCount).toBe(3)
  })

  it('reports a zero hitRate before any access', async () => {
    expect((await cache.stats()).hitRate).toBe(0)
  })

  // --- TTL & metrics -------------------------------------------------------

  it('respects TTL expiry', async () => {
    vi.useFakeTimers()
    cache = new EmbeddingCache({ adapter: new MemoryAdapter(), defaultTTL: 1000 })
    await cache.getOrGenerate('hello', generator)
    vi.advanceTimersByTime(2000)
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('emits hit, miss, and set metrics', async () => {
    const events: MetricEvent[] = []
    cache = new EmbeddingCache({
      adapter: new MemoryAdapter(),
      metrics: { emit: (e) => events.push(e) },
    })
    await cache.getOrGenerate('hello', generator)
    await cache.getOrGenerate('hello', generator)
    expect(events).toContain('cache.miss')
    expect(events).toContain('cache.set')
    expect(events).toContain('cache.hit')
  })

  it('invalidates a single entry', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.invalidate('hello')
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })
})
