import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PineconeAdapter, toPineconeFilter } from '../PineconeAdapter.js'
import type { PineconeIndex, PineconeMatch, PineconeRecord } from '../PineconeClient.js'

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

/** In-memory Pinecone index double (cosine metric → score = similarity). */
class FakeIndex implements PineconeIndex {
  store = new Map<string, { values: number[]; metadata: Record<string, unknown> }>()

  async upsert(records: PineconeRecord[]) {
    for (const r of records) this.store.set(r.id, { values: r.values, metadata: r.metadata ?? {} })
    return {}
  }
  async query(params: { vector: number[]; topK: number; filter?: Record<string, unknown> }): Promise<{ matches?: PineconeMatch[] }> {
    const eqMatch = (meta: Record<string, unknown>): boolean => {
      const f = params.filter
      if (!f) return true
      return Object.entries(f).every(([k, cond]) => (cond as { $eq: unknown }).$eq === meta[k])
    }
    const matches = [...this.store.entries()]
      .filter(([, v]) => eqMatch(v.metadata))
      .map(([id, v]) => ({ id, score: cosine(params.vector, v.values), metadata: v.metadata }))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.topK)
    return { matches }
  }
  async deleteOne(id: string) {
    this.store.delete(id)
    return {}
  }
}

describe('toPineconeFilter', () => {
  it('returns undefined for empty/absent filters', () => {
    expect(toPineconeFilter(undefined)).toBeUndefined()
    expect(toPineconeFilter({})).toBeUndefined()
  })
  it('wraps each key in $eq (implicit AND)', () => {
    expect(toPineconeFilter({ a: 1, b: 'x' })).toEqual({ a: { $eq: 1 }, b: { $eq: 'x' } })
  })
})

describe('PineconeAdapter', () => {
  let client: FakeIndex
  let adapter: PineconeAdapter<{ source?: string }>

  beforeEach(() => {
    client = new FakeIndex()
    adapter = new PineconeAdapter({ client, index: 'test' })
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

  it('returns [] when the query yields no matches', async () => {
    const empty = new PineconeAdapter({
      client: { upsert: async () => ({}), query: async () => ({}), deleteOne: async () => ({}) },
      index: 'test',
    })
    expect(await empty.query([1, 0], 5)).toEqual([])
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky: PineconeIndex = {
        upsert: vi.fn(async (records: PineconeRecord[]) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return client.upsert(records)
        }),
        query: client.query.bind(client),
        deleteOne: client.deleteOne.bind(client),
      }
      const a = new PineconeAdapter({ client: flaky, index: 'test' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    it('gives up after maxRetries', async () => {
      const broken: PineconeIndex = {
        upsert: vi.fn().mockRejectedValue(new Error('down')),
        query: vi.fn().mockRejectedValue(new Error('down')),
        deleteOne: vi.fn().mockRejectedValue(new Error('down')),
      }
      const a = new PineconeAdapter({ client: broken, index: 'test', maxRetries: 2 })
      await expect(a.query([1, 0], 5)).rejects.toThrow('down')
    })
  })
})
