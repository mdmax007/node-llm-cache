import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseCacheManager, noopMetrics } from '../BaseCacheManager.js'
import { TTLManager } from '../TTLManager.js'
import type {
  AdapterStats,
  CacheEntry,
  MetricData,
  MetricEvent,
  MetricsSink,
  StorageAdapter,
} from '../interfaces.js'
import type { CacheType } from '../types.js'

/** Minimal in-process adapter for exercising the base manager. */
class FakeAdapter<T> implements StorageAdapter<T> {
  store = new Map<string, CacheEntry<T>>()
  setCalls: Array<{ key: string; ttl?: number }> = []

  async get(key: string): Promise<CacheEntry<T> | null> {
    return this.store.get(key) ?? null
  }
  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    this.setCalls.push({ key, ttl })
    this.store.set(key, entry)
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
  async clear(): Promise<void> {
    this.store.clear()
  }
  async has(key: string): Promise<boolean> {
    return this.store.has(key)
  }
  async stats(): Promise<AdapterStats> {
    return { entryCount: this.store.size }
  }
}

class TestCache<T> extends BaseCacheManager<T> {
  protected readonly cacheType: CacheType = 'prompt'
  // Expose protected helper for assertions.
  publicBuildEntry(key: string, value: T) {
    return this.buildEntry(key, value, { provider: 'openai', model: 'gpt-4o', tokenCount: 7 })
  }
}

describe('BaseCacheManager', () => {
  let adapter: FakeAdapter<string>
  let cache: TestCache<string>
  let generator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new FakeAdapter<string>()
    cache = new TestCache<string>({ adapter })
    generator = vi.fn().mockResolvedValue('generated')
  })

  it('calls the generator on a miss', async () => {
    const result = await cache.getOrGenerate('hello', generator)
    expect(result).toBe('generated')
    expect(generator).toHaveBeenCalledOnce()
  })

  it('returns the cached value on a hit without calling the generator again', async () => {
    await cache.getOrGenerate('hello', generator)
    const result = await cache.getOrGenerate('hello', generator)
    expect(result).toBe('generated')
    expect(generator).toHaveBeenCalledOnce()
  })

  it('treats normalized inputs as the same key', async () => {
    await cache.getOrGenerate('hello world', generator)
    await cache.getOrGenerate('  Hello   World  ', generator)
    expect(generator).toHaveBeenCalledOnce()
  })

  it('differentiates by model', async () => {
    await cache.getOrGenerate('hello', generator, { model: 'gpt-4o' })
    await cache.getOrGenerate('hello', generator, { model: 'gpt-3.5-turbo' })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('bypasses the cache when cache:false without recording hits or misses', async () => {
    await cache.getOrGenerate('hello', generator, { cache: false })
    await cache.getOrGenerate('hello', generator, { cache: false })
    expect(generator).toHaveBeenCalledTimes(2)
    expect(adapter.store.size).toBe(0)
    const stats = await cache.stats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
  })

  it('does not emit metrics on a bypass', async () => {
    const events: MetricEvent[] = []
    const sink: MetricsSink = { emit: (event) => events.push(event) }
    const bypass = new TestCache<string>({ adapter, metrics: sink })
    await bypass.getOrGenerate('hello', generator, { cache: false })
    expect(events).toEqual([])
  })

  it('treats an expired entry as a miss', async () => {
    await cache.getOrGenerate('hello', generator, { ttl: 1000 })
    // Force the stored entry into the past.
    const key = [...adapter.store.keys()][0]!
    const entry = adapter.store.get(key)!
    entry.expiresAt = Date.now() - 1
    await cache.getOrGenerate('hello', generator, { ttl: 1000 })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('passes the resolved ttl to the adapter', async () => {
    const ttlCache = new TestCache<string>({ adapter, defaultTTL: 5000 })
    await ttlCache.getOrGenerate('a', generator)
    await ttlCache.getOrGenerate('b', generator, { ttl: 100 })
    expect(adapter.setCalls[0]?.ttl).toBe(5000)
    expect(adapter.setCalls[1]?.ttl).toBe(100)
  })

  it('invalidates a single entry', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.invalidate('hello')
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('tracks hit/miss/hitRate stats', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.getOrGenerate('hello', generator)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
    expect(stats.entryCount).toBe(1)
  })

  it('reports a zero hitRate before any access', async () => {
    const stats = await cache.stats()
    expect(stats.hitRate).toBe(0)
  })

  it('emits hit, miss, and set metrics', async () => {
    const events: Array<{ event: MetricEvent; data: MetricData }> = []
    const sink: MetricsSink = { emit: (event, data) => events.push({ event, data }) }
    const observed = new TestCache<string>({ adapter, metrics: sink })

    await observed.getOrGenerate('hello', generator, { model: 'gpt-4o' })
    await observed.getOrGenerate('hello', generator, { model: 'gpt-4o' })

    const names = events.map((e) => e.event)
    expect(names).toContain('cache.miss')
    expect(names).toContain('cache.set')
    expect(names).toContain('cache.hit')
    expect(events.every((e) => e.data.cacheType === 'prompt')).toBe(true)
  })

  it('builds an entry with computed expiry and metadata', () => {
    const entry = cache.publicBuildEntry('k', 'v')
    expect(entry.key).toBe('k')
    expect(entry.value).toBe('v')
    expect(entry.metadata.cacheType).toBe('prompt')
    expect(entry.metadata.provider).toBe('openai')
    expect(entry.metadata.model).toBe('gpt-4o')
    expect(entry.metadata.tokenCount).toBe(7)
    // No ttl supplied -> never expires.
    expect(entry.expiresAt).toBeUndefined()
    expect(TTLManager.isExpired(entry)).toBe(false)
  })

  it('noopMetrics.emit is a no-op', () => {
    expect(() => noopMetrics.emit('cache.hit', { cacheType: 'prompt', latencyMs: 0 })).not.toThrow()
  })

  describe('getOrRevalidate (stale-while-revalidate)', () => {
    it('records staleAt on the entry from staleTtl', () => {
      const cache2 = new TestCache<string>({ adapter })
      const e = cache2['buildEntry']('k', 'v', { ttl: 10_000, staleTtl: 1000 })
      expect(e.metadata.staleAt).toBeGreaterThan(Date.now())
      expect(e.metadata.staleAt!).toBeLessThan(e.expiresAt!)
    })

    it('serves a fresh entry without revalidating', async () => {
      await cache.getOrRevalidate('hello', generator, { ttl: 10_000, staleTtl: 5000 })
      const result = await cache.getOrRevalidate('hello', generator, { ttl: 10_000, staleTtl: 5000 })
      expect(result).toBe('generated')
      expect(generator).toHaveBeenCalledOnce() // fresh hit, no refresh
    })

    it('serves a stale value immediately and refreshes in the background', async () => {
      vi.useFakeTimers()
      let n = 0
      const gen = vi.fn().mockImplementation(() => Promise.resolve(`v${++n}`))
      const c = new TestCache<string>({ adapter: new FakeAdapter<string>() })

      const first = await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      expect(first).toBe('v1')

      vi.advanceTimersByTime(2000) // now stale (1s) but not expired (10s)
      const stale = await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      expect(stale).toBe('v1') // served stale immediately
      await vi.runAllTimersAsync() // let the background refresh resolve
      expect(gen).toHaveBeenCalledTimes(2) // one initial + one background refresh

      // Next read sees the refreshed value.
      const fresh = await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      expect(fresh).toBe('v2')
      vi.useRealTimers()
    })

    it('coalesces concurrent stale hits into a single background refresh', async () => {
      vi.useFakeTimers()
      const gen = vi.fn().mockResolvedValue('fresh')
      const a = new FakeAdapter<string>()
      const c = new TestCache<string>({ adapter: a })
      await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      vi.advanceTimersByTime(2000)
      // Two concurrent stale reads.
      await Promise.all([
        c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 }),
        c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 }),
      ])
      await vi.runAllTimersAsync()
      expect(gen).toHaveBeenCalledTimes(2) // initial + exactly one refresh (not two)
      vi.useRealTimers()
    })

    it('treats an expired entry as a miss', async () => {
      await cache.getOrRevalidate('hello', generator, { ttl: 1000, staleTtl: 500 })
      const key = [...adapter.store.keys()][0]!
      adapter.store.get(key)!.expiresAt = Date.now() - 1
      await cache.getOrRevalidate('hello', generator, { ttl: 1000, staleTtl: 500 })
      expect(generator).toHaveBeenCalledTimes(2)
    })

    it('keeps serving the stale value if the background refresh throws', async () => {
      vi.useFakeTimers()
      let call = 0
      const gen = vi.fn().mockImplementation(() => {
        call++
        return call === 1 ? Promise.resolve('v1') : Promise.reject(new Error('refresh failed'))
      })
      const c = new TestCache<string>({ adapter: new FakeAdapter<string>() })
      await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      vi.advanceTimersByTime(2000)
      const stale = await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      expect(stale).toBe('v1')
      await vi.runAllTimersAsync()
      // Still serves the stale value (refresh failed silently).
      const again = await c.getOrRevalidate('k', gen, { ttl: 10_000, staleTtl: 1000 })
      expect(again).toBe('v1')
      vi.useRealTimers()
    })

    it('bypasses the cache when cache:false', async () => {
      await cache.getOrRevalidate('hello', generator, { cache: false })
      const stats = await cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })
  })
})
