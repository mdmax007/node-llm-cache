import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TieredAdapter } from '../TieredAdapter.js'
import { ValidationError } from '@nodellmcache/core'
import type { AdapterStats, CacheEntry, StorageAdapter } from '@nodellmcache/core'

/** Minimal in-memory tier that counts get calls, for asserting read-through. */
class Tier<T> implements StorageAdapter<T> {
  store = new Map<string, CacheEntry<T>>()
  getCalls = 0
  setCalls = 0
  constructor(private readonly evictions = 0, private readonly sizeBytes?: number) {}
  async get(key: string) {
    this.getCalls++
    return this.store.get(key) ?? null
  }
  async set(key: string, entry: CacheEntry<T>) {
    this.setCalls++
    this.store.set(key, entry)
  }
  async delete(key: string) {
    this.store.delete(key)
  }
  async clear() {
    this.store.clear()
  }
  async has(key: string) {
    return this.store.has(key)
  }
  async stats(): Promise<AdapterStats> {
    return { entryCount: this.store.size, evictions: this.evictions, sizeBytes: this.sizeBytes }
  }
}

function entryOf<T>(key: string, value: T, expiresAt?: number): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    expiresAt,
    metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
  }
}

describe('TieredAdapter', () => {
  let l1: Tier<string>
  let l2: Tier<string>
  let tiered: TieredAdapter<string>

  beforeEach(() => {
    l1 = new Tier<string>()
    l2 = new Tier<string>()
    tiered = new TieredAdapter<string>({ tiers: [l1, l2] })
  })

  it('throws without any tiers', () => {
    expect(() => new TieredAdapter({ tiers: [] })).toThrow(ValidationError)
  })

  it('write-through writes to every tier', async () => {
    await tiered.set('k', entryOf('k', 'v'))
    expect(l1.store.get('k')?.value).toBe('v')
    expect(l2.store.get('k')?.value).toBe('v')
  })

  it('reads from the fastest tier without touching slower ones', async () => {
    await tiered.set('k', entryOf('k', 'v'))
    l2.getCalls = 0
    const got = await tiered.get('k')
    expect(got?.value).toBe('v')
    expect(l1.getCalls).toBeGreaterThan(0)
    expect(l2.getCalls).toBe(0) // L1 hit short-circuits
  })

  it('promotes a slower-tier hit into faster tiers', async () => {
    // Only L2 has the value (simulate L1 eviction / cold start).
    await l2.set('k', entryOf('k', 'v'))
    expect(l1.store.has('k')).toBe(false)

    const got = await tiered.get('k')
    expect(got?.value).toBe('v')
    expect(l1.store.has('k')).toBe(true) // back-filled into L1
  })

  it('returns null when no tier has the key', async () => {
    expect(await tiered.get('missing')).toBeNull()
  })

  it('skips expired entries while walking tiers', async () => {
    await l2.set('k', entryOf('k', 'v', Date.now() - 1000)) // already expired
    expect(await tiered.get('k')).toBeNull()
  })

  it('delete and clear apply to all tiers', async () => {
    await tiered.set('a', entryOf('a', '1'))
    await tiered.set('b', entryOf('b', '2'))
    await tiered.delete('a')
    expect(l1.store.has('a')).toBe(false)
    expect(l2.store.has('a')).toBe(false)
    await tiered.clear()
    expect(l1.store.size).toBe(0)
    expect(l2.store.size).toBe(0)
  })

  it('has() is true if any tier has the key', async () => {
    await l2.set('k', entryOf('k', 'v'))
    expect(await tiered.has('k')).toBe(true)
    expect(await tiered.has('nope')).toBe(false)
  })

  it('aggregates stats (max entryCount, summed sizeBytes/evictions)', async () => {
    const a = new Tier<string>(2, 100)
    const b = new Tier<string>(5, 400)
    await a.set('x', entryOf('x', '1'))
    await b.set('x', entryOf('x', '1'))
    await b.set('y', entryOf('y', '2'))
    const t = new TieredAdapter<string>({ tiers: [a, b] })
    const stats = await t.stats()
    expect(stats.entryCount).toBe(2) // max(1, 2)
    expect(stats.sizeBytes).toBe(500) // 100 + 400
    expect(stats.evictions).toBe(7) // 2 + 5
  })

  it('works with three tiers, promoting from the slowest', async () => {
    const a = new Tier<string>()
    const b = new Tier<string>()
    const c = new Tier<string>()
    const t = new TieredAdapter<string>({ tiers: [a, b, c] })
    await c.set('k', entryOf('k', 'deep'))
    const got = await t.get('k')
    expect(got?.value).toBe('deep')
    expect(a.store.has('k')).toBe(true)
    expect(b.store.has('k')).toBe(true)
  })
})
