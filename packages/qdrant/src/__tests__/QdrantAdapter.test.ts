import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QdrantAdapter } from '../QdrantAdapter.js'
import type { QdrantClient, QdrantScoredPoint } from '../QdrantClient.js'

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

/** In-memory Qdrant double with cosine search + flat `must` filtering. */
class FakeQdrant implements QdrantClient {
  collections = new Set<string>()
  createConfigs: Array<{ name: string; size: number; distance: string }> = []
  points = new Map<string, Map<string | number, { vector: number[]; payload?: Record<string, unknown> }>>()

  async getCollections() {
    return { collections: [...this.collections].map((name) => ({ name })) }
  }
  async createCollection(name: string, config: { vectors: { size: number; distance: string } }) {
    this.collections.add(name)
    this.points.set(name, new Map())
    this.createConfigs.push({ name, size: config.vectors.size, distance: config.vectors.distance })
    return {}
  }
  async upsert(name: string, params: { points: { id: string | number; vector: number[]; payload?: Record<string, unknown> }[] }) {
    const c = this.points.get(name) ?? new Map()
    for (const p of params.points) c.set(p.id, { vector: p.vector, payload: p.payload })
    this.points.set(name, c)
    return {}
  }
  async search(name: string, params: { vector: number[]; limit: number; filter?: unknown; with_payload?: boolean }): Promise<QdrantScoredPoint[]> {
    const c = this.points.get(name) ?? new Map()
    const must = ((params.filter as { must?: { key: string; match: { value: unknown } }[] } | undefined)?.must) ?? []
    return [...c.entries()]
      .filter(([, p]) => must.every((cond) => p.payload?.[cond.key] === cond.match.value))
      .map(([id, p]) => ({ id, score: cosine(params.vector, p.vector), payload: params.with_payload ? (p.payload ?? null) : null }))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit)
  }
  async delete(name: string, params: { points: (string | number)[] }) {
    const c = this.points.get(name)
    if (c) for (const id of params.points) c.delete(id)
    return {}
  }
}

describe('QdrantAdapter', () => {
  let client: FakeQdrant
  let adapter: QdrantAdapter<{ source?: string }>

  beforeEach(() => {
    client = new FakeQdrant()
    adapter = new QdrantAdapter({ client, collection: 'test' })
  })

  it('upserts and queries, restoring the original string id and stripping the id key', async () => {
    await adapter.upsert('doc-a', [1, 0, 0], { source: 'wiki' })
    const results = await adapter.query([1, 0, 0], 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('doc-a')
    expect(results[0]?.score).toBeCloseTo(1)
    expect(results[0]?.metadata).toEqual({ source: 'wiki' }) // __id removed
  })

  it('ranks results by cosine similarity', async () => {
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

  it('deletes a point', async () => {
    await adapter.upsert('a', [1, 0], {})
    await adapter.delete('a')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  it('maps the same string id to a stable point id (delete matches upsert)', async () => {
    await adapter.upsert('weird id !@#', [1, 0], {})
    await adapter.delete('weird id !@#')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  describe('collection lifecycle', () => {
    it('creates the collection on first use, inferring vector size', async () => {
      await adapter.upsert('a', [1, 2, 3, 4], {})
      expect(client.createConfigs).toEqual([{ name: 'test', size: 4, distance: 'Cosine' }])
    })

    it('only creates the collection once', async () => {
      const spy = vi.spyOn(client, 'createCollection')
      await adapter.upsert('a', [1, 0], {})
      await adapter.upsert('b', [0, 1], {})
      await adapter.query([1, 0], 5)
      expect(spy).toHaveBeenCalledOnce()
    })

    it('does not recreate an existing collection', async () => {
      await client.createCollection('test', { vectors: { size: 2, distance: 'Cosine' } })
      const spy = vi.spyOn(client, 'createCollection')
      await adapter.upsert('a', [1, 0], {})
      expect(spy).not.toHaveBeenCalled()
    })

    it('respects an explicit vectorSize and distance', async () => {
      adapter = new QdrantAdapter({ client, collection: 'c2', vectorSize: 8, distance: 'Dot' })
      await adapter.upsert('a', [1, 0], {})
      expect(client.createConfigs[0]).toEqual({ name: 'c2', size: 8, distance: 'Dot' })
    })

    it('querying an empty collection creates it and returns []', async () => {
      expect(await adapter.query([1, 0], 5)).toEqual([])
      expect(client.collections.has('test')).toBe(true)
    })
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky = {
        ...client,
        getCollections: client.getCollections.bind(client),
        createCollection: client.createCollection.bind(client),
        search: client.search.bind(client),
        delete: client.delete.bind(client),
        upsert: vi.fn(async (...args: Parameters<QdrantClient['upsert']>) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return client.upsert(...args)
        }),
      } as unknown as QdrantClient
      const a = new QdrantAdapter({ client: flaky, collection: 'test' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBe(2)
    })

    it('gives up after maxRetries', async () => {
      const broken = {
        getCollections: vi.fn().mockRejectedValue(new Error('down')),
      } as unknown as QdrantClient
      const a = new QdrantAdapter({ client: broken, collection: 'test', maxRetries: 2 })
      await expect(a.upsert('x', [1, 0], {})).rejects.toThrow('down')
    })
  })
})
