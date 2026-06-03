import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryAdapter } from '../MemoryAdapter.js'
import { estimateSize } from '../estimateSize.js'
import { CompressionEngine } from '@nodellmcache/compression'
import type { CacheEntry, CacheType, MetricData, MetricEvent } from '@nodellmcache/core'

function entryOf<T>(
  key: string,
  value: T,
  opts?: { expiresAt?: number; cacheType?: CacheType },
): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    expiresAt: opts?.expiresAt,
    metadata: { compressed: false, originalSize: 0, cacheType: opts?.cacheType ?? 'prompt' },
  }
}

describe('MemoryAdapter', () => {
  describe('basic operations', () => {
    let adapter: MemoryAdapter<string>
    beforeEach(() => {
      adapter = new MemoryAdapter<string>()
    })

    it('sets and gets a value', async () => {
      await adapter.set('k', entryOf('k', 'hello'))
      const got = await adapter.get('k')
      expect(got?.value).toBe('hello')
      expect(got?.key).toBe('k')
    })

    it('returns null on a miss', async () => {
      expect(await adapter.get('nope')).toBeNull()
    })

    it('has() reflects presence', async () => {
      expect(await adapter.has('k')).toBe(false)
      await adapter.set('k', entryOf('k', 'v'))
      expect(await adapter.has('k')).toBe(true)
    })

    it('deletes a key', async () => {
      await adapter.set('k', entryOf('k', 'v'))
      await adapter.delete('k')
      expect(await adapter.has('k')).toBe(false)
    })

    it('delete of a missing key is a no-op', async () => {
      await expect(adapter.delete('ghost')).resolves.toBeUndefined()
    })

    it('clears all entries and resets size', async () => {
      await adapter.set('a', entryOf('a', 'x'))
      await adapter.set('b', entryOf('b', 'y'))
      await adapter.clear()
      expect((await adapter.stats()).entryCount).toBe(0)
      expect((await adapter.stats()).sizeBytes).toBe(0)
    })

    it('overwrites an existing key without growing entry count', async () => {
      await adapter.set('k', entryOf('k', 'first'))
      await adapter.set('k', entryOf('k', 'second'))
      expect((await adapter.get('k'))?.value).toBe('second')
      expect((await adapter.stats()).entryCount).toBe(1)
    })
  })

  describe('TTL', () => {
    beforeEach(() => vi.useFakeTimers())

    it('expires an entry after its ttl', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('k', entryOf('k', 'v'), 1000)
      expect((await adapter.get('k'))?.value).toBe('v')
      vi.advanceTimersByTime(1500)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('applies the adapter defaultTTL when none is supplied', async () => {
      const adapter = new MemoryAdapter<string>({ defaultTTL: 1000 })
      await adapter.set('k', entryOf('k', 'v'))
      vi.advanceTimersByTime(1500)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('lets the ttl argument override the entry expiry', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('k', entryOf('k', 'v', { expiresAt: Date.now() + 1_000_000 }), 500)
      vi.advanceTimersByTime(800)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('never expires when no ttl is configured', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('k', entryOf('k', 'v'))
      vi.advanceTimersByTime(10_000_000)
      expect((await adapter.get('k'))?.value).toBe('v')
      vi.useRealTimers()
    })

    it('get() returns null for an entry expired at read time', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('k', entryOf('k', 'v', { expiresAt: Date.now() + 100 }))
      // Advance the wall clock past expiry without running the timer callback.
      vi.setSystemTime(Date.now() + 1000)
      expect(await adapter.get('k')).toBeNull()
      expect((await adapter.stats()).entryCount).toBe(0)
      vi.useRealTimers()
    })

    it('has() evicts an expired entry', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('k', entryOf('k', 'v', { expiresAt: Date.now() + 100 }))
      vi.advanceTimersByTime(50) // before expiry; timer not yet fired
      expect(await adapter.has('k')).toBe(true)
      // Move past expiry without letting the timer callback run by faking the clock read.
      vi.setSystemTime(Date.now() + 1000)
      expect(await adapter.has('k')).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when over capacity', async () => {
      const adapter = new MemoryAdapter<string>({ maxSize: 100 })
      await adapter.set('a', entryOf('a', 'x'.repeat(40)))
      await adapter.set('b', entryOf('b', 'y'.repeat(40)))
      await adapter.set('c', entryOf('c', 'z'.repeat(40))) // 120 > 100 -> evict 'a'
      expect(await adapter.has('a')).toBe(false)
      expect(await adapter.has('b')).toBe(true)
      expect(await adapter.has('c')).toBe(true)
      expect((await adapter.stats()).evictions).toBe(1)
    })

    it('treats a read as recent use, sparing it from eviction', async () => {
      const adapter = new MemoryAdapter<string>({ maxSize: 100 })
      await adapter.set('a', entryOf('a', 'x'.repeat(40)))
      await adapter.set('b', entryOf('b', 'y'.repeat(40)))
      await adapter.get('a') // 'a' becomes most-recently-used
      await adapter.set('c', entryOf('c', 'z'.repeat(40))) // should evict 'b'
      expect(await adapter.has('a')).toBe(true)
      expect(await adapter.has('b')).toBe(false)
      expect(await adapter.has('c')).toBe(true)
    })

    it('does not store a single entry larger than maxSize', async () => {
      const adapter = new MemoryAdapter<string>({ maxSize: 10 })
      await adapter.set('big', entryOf('big', 'x'.repeat(100)))
      expect(await adapter.get('big')).toBeNull()
      expect((await adapter.stats()).entryCount).toBe(0)
    })

    it('emits cache.evict metrics on capacity eviction', async () => {
      const events: Array<{ event: MetricEvent; data: MetricData }> = []
      const adapter = new MemoryAdapter<string>({
        maxSize: 50,
        metrics: { emit: (event, data) => events.push({ event, data }) },
      })
      await adapter.set('a', entryOf('a', 'x'.repeat(40), { cacheType: 'embedding' }))
      await adapter.set('b', entryOf('b', 'y'.repeat(40)))
      const evict = events.find((e) => e.event === 'cache.evict')
      expect(evict).toBeDefined()
      expect(evict?.data.cacheType).toBe('embedding')
    })
  })

  describe('stats', () => {
    it('reports entry count and total size', async () => {
      const adapter = new MemoryAdapter<string>()
      await adapter.set('a', entryOf('a', 'hello'))
      const stats = await adapter.stats()
      expect(stats.entryCount).toBe(1)
      expect(stats.sizeBytes).toBe(estimateSize('hello'))
      expect(stats.evictions).toBe(0)
    })
  })

  describe('compression', () => {
    it('round-trips a value with auto compression (injected engine)', async () => {
      const adapter = new MemoryAdapter<{ n: number; text: string }>({
        compression: 'auto',
        compressionEngine: new CompressionEngine(),
      })
      const value = { n: 42, text: 'hello '.repeat(500) }
      await adapter.set('k', entryOf('k', value))
      expect((await adapter.get('k'))?.value).toEqual(value)
      // Compressed footprint should be smaller than the raw estimate.
      expect((await adapter.stats()).sizeBytes).toBeLessThan(estimateSize(value))
    })

    it('round-trips with a fixed algorithm (gzip)', async () => {
      const adapter = new MemoryAdapter<string>({
        compression: 'gzip',
        compressionEngine: new CompressionEngine(),
      })
      const value = 'data '.repeat(500)
      await adapter.set('k', entryOf('k', value))
      expect((await adapter.get('k'))?.value).toBe(value)
    })

    it('uses the embedding hint for embedding entries', async () => {
      const adapter = new MemoryAdapter<number[]>({
        compression: 'auto',
        compressionEngine: new CompressionEngine(),
      })
      const emb = Array.from({ length: 200 }, (_, i) => i * 0.01)
      await adapter.set('e', entryOf('e', emb, { cacheType: 'embedding' }))
      expect((await adapter.get('e'))?.value).toEqual(emb)
    })

    it("treats compression:'none' as the raw fast path", async () => {
      const adapter = new MemoryAdapter<string>({ compression: 'none' })
      await adapter.set('k', entryOf('k', 'plain'))
      expect((await adapter.get('k'))?.value).toBe('plain')
    })

    it('lazily loads @nodellmcache/compression when no engine is injected', async () => {
      const adapter = new MemoryAdapter<string>({ compression: 'auto' })
      const value = 'lazy '.repeat(500)
      await adapter.set('k', entryOf('k', value))
      expect((await adapter.get('k'))?.value).toBe(value)
    })
  })

  describe('concurrency', () => {
    it('handles many concurrent sets and gets', async () => {
      const adapter = new MemoryAdapter<number>({ maxSize: 10 * 1024 * 1024 })
      await Promise.all(
        Array.from({ length: 100 }, (_, i) => adapter.set(`k${i}`, entryOf(`k${i}`, i))),
      )
      const got = await Promise.all(
        Array.from({ length: 100 }, (_, i) => adapter.get(`k${i}`)),
      )
      expect(got.every((g, i) => g?.value === i)).toBe(true)
      expect((await adapter.stats()).entryCount).toBe(100)
    })
  })
})
