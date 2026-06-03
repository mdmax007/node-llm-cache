import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextCache } from '../ContextCache.js'
import { MemoryAdapter } from '@nodellmcache/memory'

describe('ContextCache', () => {
  let cache: ContextCache
  let assemble: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cache = new ContextCache({ adapter: new MemoryAdapter<string>() })
    assemble = vi.fn().mockResolvedValue('assembled context')
  })

  it('caches an assembled context for a query + document set', async () => {
    const r1 = await cache.getOrAssemble('q', ['d1', 'd2'], assemble)
    const r2 = await cache.getOrAssemble('q', ['d1', 'd2'], assemble)
    expect(assemble).toHaveBeenCalledOnce()
    expect(r2).toBe(r1)
  })

  it('is order-independent over the document set', async () => {
    await cache.getOrAssemble('q', ['d1', 'd2'], assemble)
    await cache.getOrAssemble('q', ['d2', 'd1'], assemble)
    expect(assemble).toHaveBeenCalledOnce()
  })

  it('busts the cache when the document set changes', async () => {
    await cache.getOrAssemble('q', ['d1', 'd2'], assemble)
    await cache.getOrAssemble('q', ['d1', 'd3'], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
  })

  it('busts the cache when a document version changes', async () => {
    await cache.getOrAssemble('q', [{ id: 'd1', version: 1 }], assemble)
    await cache.getOrAssemble('q', [{ id: 'd1', version: 2 }], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
  })

  it('treats versioned and unversioned refs to the same id distinctly', async () => {
    await cache.getOrAssemble('q', ['d1'], assemble)
    await cache.getOrAssemble('q', [{ id: 'd1', version: 'v9' }], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
  })

  it('treats an object ref without version like the bare id', async () => {
    await cache.getOrAssemble('q', ['d1'], assemble)
    await cache.getOrAssemble('q', [{ id: 'd1' }], assemble)
    expect(assemble).toHaveBeenCalledOnce()
  })

  it('distinguishes different queries over the same documents', async () => {
    await cache.getOrAssemble('q1', ['d1'], assemble)
    await cache.getOrAssemble('q2', ['d1'], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
  })

  it('invalidates a specific assembled context', async () => {
    await cache.getOrAssemble('q', ['d1'], assemble)
    await cache.invalidateAssembled('q', ['d1'])
    await cache.getOrAssemble('q', ['d1'], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
  })

  it('respects TTL freshness', async () => {
    vi.useFakeTimers()
    cache = new ContextCache({ adapter: new MemoryAdapter<string>(), defaultTTL: 1000 })
    await cache.getOrAssemble('q', ['d1'], assemble)
    vi.advanceTimersByTime(2000)
    await cache.getOrAssemble('q', ['d1'], assemble)
    expect(assemble).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('tracks hit/miss stats', async () => {
    await cache.getOrAssemble('q', ['d1'], assemble)
    await cache.getOrAssemble('q', ['d1'], assemble)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('supports a structured context value type', async () => {
    interface Ctx { text: string; tokens: number }
    const typed = new ContextCache<Ctx>({ adapter: new MemoryAdapter<Ctx>() })
    const gen = vi.fn().mockResolvedValue({ text: 'x', tokens: 10 })
    const result = await typed.getOrAssemble('q', ['d1'], gen)
    expect(result).toEqual({ text: 'x', tokens: 10 })
  })
})
