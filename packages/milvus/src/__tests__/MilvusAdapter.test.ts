import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MilvusAdapter } from '../MilvusAdapter.js'
import { buildExpr } from '../client.js'
import type { MilvusRow, MilvusStore } from '../MilvusStore.js'

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

/** In-memory MilvusStore (cosine metric → score = similarity). */
class FakeStore implements MilvusStore {
  data = new Map<string, { vector: number[]; metadata: Record<string, unknown> }>()
  closed = false

  async upsert(id: string, vector: number[], metadata: Record<string, unknown>) {
    this.data.set(id, { vector, metadata })
  }
  async query(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<MilvusRow[]> {
    return [...this.data.entries()]
      .filter(([, v]) => (filter ? Object.entries(filter).every(([k, val]) => v.metadata[k] === val) : true))
      .map(([id, v]) => ({ id, score: cosine(vector, v.vector), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
  async deleteById(id: string) {
    this.data.delete(id)
  }
  async close() {
    this.closed = true
  }
}

describe('buildExpr', () => {
  it('returns undefined for empty/absent filters', () => {
    expect(buildExpr(undefined)).toBeUndefined()
    expect(buildExpr({})).toBeUndefined()
  })
  it('builds a JSON-field equality expression', () => {
    expect(buildExpr({ source: 'wiki' })).toBe('metadata["source"] == "wiki"')
    expect(buildExpr({ year: 2024 })).toBe('metadata["year"] == 2024')
  })
  it('joins multiple conditions with and', () => {
    expect(buildExpr({ source: 'wiki', year: 2024 })).toBe(
      'metadata["source"] == "wiki" and metadata["year"] == 2024',
    )
  })
})

describe('MilvusAdapter', () => {
  let store: FakeStore
  let adapter: MilvusAdapter<{ source?: string }>

  beforeEach(() => {
    store = new FakeStore()
    adapter = new MilvusAdapter({ store, collection: 'test' })
  })

  it('upserts and queries, returning id, score, and metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    const results = await adapter.query([1, 0, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.score).toBeCloseTo(1)
    expect(results[0]?.metadata).toEqual({ source: 'wiki' })
  })

  it('ranks by similarity', async () => {
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

  it('deletes a vector', async () => {
    await adapter.upsert('a', [1, 0], {})
    await adapter.delete('a')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  it('disconnect closes the store', async () => {
    await adapter.disconnect()
    expect(store.closed).toBe(true)
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky: MilvusStore = {
        ...store,
        upsert: vi.fn(async (...args: Parameters<MilvusStore['upsert']>) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return store.upsert(...args)
        }),
        query: store.query.bind(store),
        deleteById: store.deleteById.bind(store),
        close: store.close.bind(store),
      }
      const a = new MilvusAdapter({ store: flaky, collection: 'test' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    it('gives up after maxRetries', async () => {
      const broken: MilvusStore = {
        upsert: vi.fn().mockRejectedValue(new Error('down')),
        query: vi.fn().mockRejectedValue(new Error('down')),
        deleteById: vi.fn().mockRejectedValue(new Error('down')),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const a = new MilvusAdapter({ store: broken, collection: 'test', maxRetries: 2 })
      await expect(a.query([1, 0], 5)).rejects.toThrow('down')
    })
  })
})
