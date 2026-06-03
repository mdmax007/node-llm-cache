import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChromaAdapter, toChromaWhere } from '../ChromaAdapter.js'
import type { ChromaClient, ChromaCollection, ChromaQueryResult } from '../ChromaClient.js'

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

/** In-memory Chroma collection returning cosine distance (1 - similarity). */
class FakeCollection implements ChromaCollection {
  store = new Map<string, { vector: number[]; metadata: Record<string, unknown> }>()

  async upsert(params: { ids: string[]; embeddings: number[][]; metadatas?: Record<string, unknown>[] }) {
    params.ids.forEach((id, i) => {
      this.store.set(id, { vector: params.embeddings[i]!, metadata: params.metadatas?.[i] ?? {} })
    })
    return {}
  }
  async query(params: { queryEmbeddings: number[][]; nResults: number; where?: Record<string, unknown> }): Promise<ChromaQueryResult> {
    const q = params.queryEmbeddings[0]!
    const matchWhere = (meta: Record<string, unknown>): boolean => {
      const w = params.where
      if (!w) return true
      const conds = '$and' in w ? (w.$and as Record<string, unknown>[]) : [w]
      return conds.every((c) => Object.entries(c).every(([k, v]) => meta[k] === v))
    }
    const ranked = [...this.store.entries()]
      .filter(([, v]) => matchWhere(v.metadata))
      .map(([id, v]) => ({ id, distance: 1 - cosine(q, v.vector), metadata: v.metadata }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, params.nResults)
    return {
      ids: [ranked.map((r) => r.id)],
      distances: [ranked.map((r) => r.distance)],
      metadatas: [ranked.map((r) => r.metadata)],
    }
  }
  async delete(params: { ids: string[] }) {
    for (const id of params.ids) this.store.delete(id)
    return {}
  }
}

class FakeClient implements ChromaClient {
  collections = new Map<string, FakeCollection>()
  getOrCreateCalls: Array<{ name: string; metadata?: Record<string, unknown> }> = []
  async getOrCreateCollection(params: { name: string; metadata?: Record<string, unknown> }) {
    this.getOrCreateCalls.push(params)
    const existing = this.collections.get(params.name)
    if (existing) return existing
    const col = new FakeCollection()
    this.collections.set(params.name, col)
    return col
  }
}

describe('toChromaWhere', () => {
  it('returns undefined for empty/absent filters', () => {
    expect(toChromaWhere(undefined)).toBeUndefined()
    expect(toChromaWhere({})).toBeUndefined()
  })
  it('passes a single equality through', () => {
    expect(toChromaWhere({ source: 'wiki' })).toEqual({ source: 'wiki' })
  })
  it('combines multiple keys with $and', () => {
    expect(toChromaWhere({ a: 1, b: 2 })).toEqual({ $and: [{ a: 1 }, { b: 2 }] })
  })
})

describe('ChromaAdapter', () => {
  let client: FakeClient
  let adapter: ChromaAdapter<{ source?: string }>

  beforeEach(() => {
    client = new FakeClient()
    adapter = new ChromaAdapter({ client, collection: 'test' })
  })

  it('upserts and queries, returning id, similarity score, and metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    const results = await adapter.query([1, 0, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.score).toBeCloseTo(1)
    expect(results[0]?.metadata).toEqual({ source: 'wiki' })
  })

  it('ranks by similarity (closest distance first)', async () => {
    await adapter.upsert('near', [1, 0], { source: 'a' })
    await adapter.upsert('far', [0, 1], { source: 'b' })
    const results = await adapter.query([0.9, 0.1], 5)
    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('filters by metadata', async () => {
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

  it('deletes a point', async () => {
    await adapter.upsert('a', [1, 0], {})
    await adapter.delete('a')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  it('creates the collection once with the configured space', async () => {
    await adapter.upsert('a', [1, 0], {})
    await adapter.query([1, 0], 5)
    expect(client.getOrCreateCalls).toHaveLength(1)
    expect(client.getOrCreateCalls[0]?.metadata).toEqual({ 'hnsw:space': 'cosine' })
  })

  it('passes a custom space through', async () => {
    adapter = new ChromaAdapter({ client, collection: 'c2', space: 'l2' })
    await adapter.upsert('a', [1, 0], {})
    expect(client.getOrCreateCalls[0]?.metadata).toEqual({ 'hnsw:space': 'l2' })
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky: ChromaClient = {
        getOrCreateCollection: vi.fn(async (p) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return client.getOrCreateCollection(p)
        }),
      }
      const a = new ChromaAdapter({ client: flaky, collection: 'test' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    it('gives up after maxRetries', async () => {
      const broken: ChromaClient = {
        getOrCreateCollection: vi.fn().mockRejectedValue(new Error('down')),
      }
      const a = new ChromaAdapter({ client: broken, collection: 'test', maxRetries: 2 })
      await expect(a.query([1, 0], 5)).rejects.toThrow('down')
    })

    it('does not cache a failed collection fetch (retries on the next call)', async () => {
      let attempts = 0
      const flaky: ChromaClient = {
        getOrCreateCollection: vi.fn(async (p) => {
          attempts++
          if (attempts === 1) throw new Error('transient')
          return client.getOrCreateCollection(p)
        }),
      }
      const a = new ChromaAdapter({ client: flaky, collection: 'test', maxRetries: 1 })
      // First use fails and must NOT be cached.
      await expect(a.query([1, 0], 5)).rejects.toThrow('transient')
      // Next use re-fetches the collection and succeeds.
      await a.upsert('a', [1, 0], {})
      const results = await a.query([1, 0], 5)
      expect(results[0]?.id).toBe('a')
      expect(attempts).toBeGreaterThanOrEqual(2)
    })
  })
})
