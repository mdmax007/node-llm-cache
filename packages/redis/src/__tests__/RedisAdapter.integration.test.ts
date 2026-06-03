import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { RedisAdapter } from '../RedisAdapter.js'
import type { CacheEntry } from '@nodellmcache/core'

const REDIS_URL = process.env.REDIS_URL

function entryOf<T>(key: string, value: T): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
  }
}

// Runs only when REDIS_URL is set (e.g. `docker compose up -d redis`).
describe.skipIf(!REDIS_URL)('RedisAdapter @integration', () => {
  let adapter: RedisAdapter

  beforeAll(() => {
    adapter = new RedisAdapter({ url: REDIS_URL, namespace: 'nodellmcache-test:' })
  })

  beforeEach(async () => {
    await adapter.clear()
  })

  afterAll(async () => {
    await adapter.clear()
    await adapter.disconnect()
  })

  it('responds to ping', async () => {
    expect(await adapter.ping()).toBe(true)
  })

  it('sets and gets a value', async () => {
    await adapter.set('test', entryOf('test', { hello: 'world' }))
    const result = await adapter.get('test')
    expect(result?.value).toEqual({ hello: 'world' })
  })

  it('respects TTL expiry', async () => {
    await adapter.set('ttl', entryOf('ttl', 'bye'), 100)
    await new Promise((r) => setTimeout(r, 200))
    expect(await adapter.get('ttl')).toBeNull()
  })

  it('deletes and clears', async () => {
    await adapter.set('a', entryOf('a', 1))
    await adapter.set('b', entryOf('b', 2))
    await adapter.delete('a')
    expect(await adapter.has('a')).toBe(false)
    expect(await adapter.has('b')).toBe(true)
    await adapter.clear()
    expect(await adapter.has('b')).toBe(false)
  })

  it('round-trips compressed values', async () => {
    const { CompressionEngine } = await import('@nodellmcache/compression')
    const c = new RedisAdapter({
      url: REDIS_URL,
      namespace: 'nodellmcache-test:',
      compression: 'auto',
      compressionEngine: new CompressionEngine(),
    })
    const value = { text: 'compress me '.repeat(500) }
    await c.set('z', entryOf('z', value))
    expect((await c.get('z'))?.value).toEqual(value)
    await c.disconnect()
  })

  it('reports stats', async () => {
    await adapter.set('s', entryOf('s', 'v'))
    const stats = await adapter.stats()
    expect(stats.entryCount).toBeGreaterThanOrEqual(1)
    expect(stats.sizeBytes).toBeGreaterThan(0)
  })
})
