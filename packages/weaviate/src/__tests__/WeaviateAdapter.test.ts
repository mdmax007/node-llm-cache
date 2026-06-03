import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WeaviateAdapter } from '../WeaviateAdapter.js'
import { toUuid, type WeaviateStore, type WeaviateRow } from '../WeaviateStore.js'

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/** In-memory WeaviateStore returning cosine distance (1 - similarity). */
class FakeStore implements WeaviateStore {
  data = new Map<string, { vector: number[]; properties: Record<string, unknown> }>()
  closed = false

  async upsert(uuid: string, vector: number[], properties: Record<string, unknown>) {
    this.data.set(uuid, { vector, properties })
  }
  async query(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<WeaviateRow[]> {
    return [...this.data.entries()]
      .filter(([, v]) => (filter ? Object.entries(filter).every(([k, val]) => v.properties[k] === val) : true))
      .map(([uuid, v]) => ({ uuid, distance: 1 - cosine(vector, v.vector), properties: v.properties }))
      .sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1))
      .slice(0, limit)
  }
  async deleteById(uuid: string) {
    this.data.delete(uuid)
  }
  async close() {
    this.closed = true
  }
}

describe('toUuid', () => {
  it('produces a stable, v4-shaped UUID', () => {
    expect(toUuid('abc')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(toUuid('abc')).toBe(toUuid('abc'))
    expect(toUuid('abc')).not.toBe(toUuid('xyz'))
  })
})

describe('WeaviateAdapter', () => {
  let store: FakeStore
  let adapter: WeaviateAdapter<{ source?: string }>

  beforeEach(() => {
    store = new FakeStore()
    adapter = new WeaviateAdapter({ store, collection: 'Test' })
  })

  it('upserts and queries, restoring the string id and stripping the id key', async () => {
    await adapter.upsert('doc-a', [1, 0, 0], { source: 'wiki' })
    const results = await adapter.query([1, 0, 0], 5)
    expect(results[0]?.id).toBe('doc-a')
    expect(results[0]?.score).toBeCloseTo(1)
    expect(results[0]?.metadata).toEqual({ source: 'wiki' })
  })

  it('stores under the deterministic UUID for the id', async () => {
    await adapter.upsert('doc-a', [1, 0], {})
    expect(store.data.has(toUuid('doc-a'))).toBe(true)
  })

  it('ranks by cosine similarity', async () => {
    await adapter.upsert('near', [1, 0], { source: 'a' })
    await adapter.upsert('far', [0, 1], { source: 'b' })
    const results = await adapter.query([0.9, 0.1], 5)
    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('applies a metadata filter', async () => {
    await adapter.upsert('a', [1, 0], { source: 'wiki' })
    await adapter.upsert('b', [1, 0], { source: 'blog' })
    const results = await adapter.query([1, 0], 5, { source: 'blog' })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('b')
  })

  it('honors topK', async () => {
    for (let i = 0; i < 5; i++) await adapter.upsert(`d${i}`, [1, i * 0.01], {})
    expect(await adapter.query([1, 0], 2)).toHaveLength(2)
  })

  it('deletes by id (matching the upsert mapping)', async () => {
    await adapter.upsert('weird id !@#', [1, 0], {})
    await adapter.delete('weird id !@#')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  it('disconnect closes the store', async () => {
    await adapter.disconnect()
    expect(store.closed).toBe(true)
  })

  it('falls back to uuid when the id property is missing', async () => {
    // Simulate an object written without the id key.
    await store.upsert(toUuid('x'), [1, 0], { source: 'manual' })
    const results = await adapter.query([1, 0], 5)
    expect(results[0]?.id).toBe(toUuid('x'))
    expect(results[0]?.metadata).toEqual({ source: 'manual' })
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky: WeaviateStore = {
        ...store,
        upsert: vi.fn(async (...args: Parameters<WeaviateStore['upsert']>) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return store.upsert(...args)
        }),
        query: store.query.bind(store),
        deleteById: store.deleteById.bind(store),
        close: store.close.bind(store),
      }
      const a = new WeaviateAdapter({ store: flaky, collection: 'Test' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    it('gives up after maxRetries', async () => {
      const broken: WeaviateStore = {
        upsert: vi.fn().mockRejectedValue(new Error('down')),
        query: vi.fn().mockRejectedValue(new Error('down')),
        deleteById: vi.fn().mockRejectedValue(new Error('down')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const a = new WeaviateAdapter({ store: broken, collection: 'Test', maxRetries: 2 })
      await expect(a.query([1, 0], 5)).rejects.toThrow('down')
    })
  })
})
