import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RedisAdapter } from '../RedisAdapter.js'
import { CompressionEngine } from '@nodellmcache/compression'
import type { RedisClient } from '../RedisClient.js'
import type { CacheEntry, CacheType } from '@nodellmcache/core'

/** In-memory RedisClient honoring PX expiry, for unit tests. */
class FakeRedis implements RedisClient {
  store = new Map<string, { value: string; expireAt?: number }>()

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key)
    if (!e) return null
    if (e.expireAt !== undefined && e.expireAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return e.value
  }
  async set(key: string, value: string, mode?: 'PX', ttlMs?: number): Promise<unknown> {
    const expireAt = mode === 'PX' && typeof ttlMs === 'number' ? Date.now() + ttlMs : undefined
    this.store.set(key, { value, expireAt })
    return 'OK'
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) if (this.store.delete(k)) n++
    return n
  }
  async exists(key: string): Promise<number> {
    return (await this.get(key)) !== null ? 1 : 0
  }
  async scan(
    _cursor: string,
    _m: 'MATCH',
    pattern: string,
    _c: 'COUNT',
    _count: number,
  ): Promise<[string, string[]]> {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '.*') + '$')
    return ['0', [...this.store.keys()].filter((k) => re.test(k))]
  }
  async info(): Promise<string> {
    return 'used_memory:1048576\r\nevicted_keys:7\r\nother:x\r\n'
  }
  async ping(): Promise<string> {
    return 'PONG'
  }
  async quit(): Promise<unknown> {
    return 'OK'
  }
}

function entryOf<T>(key: string, value: T, opts?: { expiresAt?: number; cacheType?: CacheType }): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    expiresAt: opts?.expiresAt,
    metadata: { compressed: false, originalSize: 0, cacheType: opts?.cacheType ?? 'prompt' },
  }
}

describe('RedisAdapter', () => {
  let client: FakeRedis
  let adapter: RedisAdapter<unknown>

  beforeEach(() => {
    client = new FakeRedis()
    adapter = new RedisAdapter({ client })
  })

  describe('basic operations', () => {
    it('sets and gets a value', async () => {
      await adapter.set('k', entryOf('k', { answer: 42 }))
      const got = await adapter.get('k')
      expect(got?.value).toEqual({ answer: 42 })
      expect(got?.key).toBe('k')
    })

    it('returns null on a miss', async () => {
      expect(await adapter.get('nope')).toBeNull()
    })

    it('namespaces keys with the default prefix', async () => {
      await adapter.set('k', entryOf('k', 'v'))
      expect([...client.store.keys()]).toEqual(['nodellmcache:k'])
    })

    it('honors a custom namespace', async () => {
      adapter = new RedisAdapter({ client, namespace: 'app:' })
      await adapter.set('k', entryOf('k', 'v'))
      expect(client.store.has('app:k')).toBe(true)
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

    it('clear() removes only namespaced keys', async () => {
      await adapter.set('a', entryOf('a', 1))
      await adapter.set('b', entryOf('b', 2))
      client.store.set('foreign-key', { value: 'x' }) // outside namespace
      await adapter.clear()
      expect(await adapter.has('a')).toBe(false)
      expect(await adapter.has('b')).toBe(false)
      expect(client.store.has('foreign-key')).toBe(true)
    })
  })

  describe('TTL', () => {
    beforeEach(() => vi.useFakeTimers())

    it('passes an explicit ttl as PX and expires the key', async () => {
      const spy = vi.spyOn(client, 'set')
      await adapter.set('k', entryOf('k', 'v'), 1000)
      expect(spy).toHaveBeenCalledWith('nodellmcache:k', expect.any(String), 'PX', 1000)
      vi.advanceTimersByTime(1500)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('derives PX from entry.expiresAt', async () => {
      const spy = vi.spyOn(client, 'set')
      await adapter.set('k', entryOf('k', 'v', { expiresAt: Date.now() + 5000 }))
      expect(spy).toHaveBeenCalledWith('nodellmcache:k', expect.any(String), 'PX', expect.any(Number))
      vi.useRealTimers()
    })

    it('applies adapter defaultTTL when none is supplied', async () => {
      adapter = new RedisAdapter({ client, defaultTTL: 1000 })
      await adapter.set('k', entryOf('k', 'v'))
      vi.advanceTimersByTime(1500)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('stores without expiry when no ttl applies', async () => {
      const spy = vi.spyOn(client, 'set')
      await adapter.set('k', entryOf('k', 'v'))
      expect(spy).toHaveBeenCalledWith('nodellmcache:k', expect.any(String))
      vi.useRealTimers()
    })

    it('does not persist an entry whose expiresAt is already in the past', async () => {
      await adapter.set('k', entryOf('k', 'v', { expiresAt: Date.now() - 1000 }))
      expect(client.store.has('nodellmcache:k')).toBe(false)
      expect(await adapter.get('k')).toBeNull()
      vi.useRealTimers()
    })

    it('overwriting with an expired entry removes the prior value', async () => {
      await adapter.set('k', entryOf('k', 'fresh')) // stored, no expiry
      await adapter.set('k', entryOf('k', 'stale', { expiresAt: Date.now() - 1000 }))
      expect(await adapter.get('k')).toBeNull()
      expect(client.store.has('nodellmcache:k')).toBe(false)
      vi.useRealTimers()
    })

    it('defensively treats a past-expiry envelope as a miss', async () => {
      // Store an envelope whose logical expiry is in the past, but without PX
      // (so the fake returns it) — get() must detect and drop it.
      const past = Date.now() - 1000
      const payload = JSON.stringify({
        k: 'raw',
        value: 'stale',
        createdAt: past - 1000,
        expiresAt: past,
        metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
      })
      client.store.set('nodellmcache:k', { value: payload })
      expect(await adapter.get('k')).toBeNull()
      expect(client.store.has('nodellmcache:k')).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('compression', () => {
    it('round-trips with auto compression (injected engine)', async () => {
      adapter = new RedisAdapter({ client, compression: 'auto', compressionEngine: new CompressionEngine() })
      const value = { text: 'hello '.repeat(500) }
      await adapter.set('k', entryOf('k', value))
      // Stored envelope is the compressed form.
      expect(client.store.get('nodellmcache:k')!.value).toContain('"k":"gz"')
      expect((await adapter.get('k'))?.value).toEqual(value)
    })

    it('round-trips with a fixed algorithm (gzip)', async () => {
      adapter = new RedisAdapter({ client, compression: 'gzip', compressionEngine: new CompressionEngine() })
      await adapter.set('k', entryOf('k', 'data '.repeat(300)))
      expect((await adapter.get('k'))?.value).toBe('data '.repeat(300))
    })

    it('uses the embedding hint for embedding entries', async () => {
      adapter = new RedisAdapter({ client, compression: 'auto', compressionEngine: new CompressionEngine() })
      const emb = Array.from({ length: 200 }, (_, i) => i * 0.01)
      await adapter.set('e', entryOf('e', emb, { cacheType: 'embedding' }))
      expect((await adapter.get('e'))?.value).toEqual(emb)
    })

    it('lazily loads @nodellmcache/compression when no engine is injected', async () => {
      adapter = new RedisAdapter({ client, compression: 'auto' })
      const value = 'lazy '.repeat(300)
      await adapter.set('k', entryOf('k', value))
      expect((await adapter.get('k'))?.value).toBe(value)
    })

    it("treats compression:'none' as the inline path", async () => {
      adapter = new RedisAdapter({ client, compression: 'none' })
      await adapter.set('k', entryOf('k', 'plain'))
      expect(client.store.get('nodellmcache:k')!.value).toContain('"k":"raw"')
      expect((await adapter.get('k'))?.value).toBe('plain')
    })
  })

  describe('stats / health', () => {
    it('reports entryCount, sizeBytes, and evictions from INFO', async () => {
      await adapter.set('a', entryOf('a', 1))
      await adapter.set('b', entryOf('b', 2))
      const stats = await adapter.stats()
      expect(stats.entryCount).toBe(2)
      expect(stats.sizeBytes).toBe(1048576)
      expect(stats.evictions).toBe(7)
    })

    it('ping() returns true on PONG', async () => {
      expect(await adapter.ping()).toBe(true)
    })

    it('disconnect() calls quit', async () => {
      const spy = vi.spyOn(client, 'quit')
      await adapter.disconnect()
      expect(spy).toHaveBeenCalledOnce()
    })
  })
})
