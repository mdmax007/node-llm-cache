import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgVectorAdapter, toVectorLiteral } from '../PgVectorAdapter.js'
import { ValidationError } from '@nodellmcache/core'
import type { PgClient } from '../PgClient.js'

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
const parseVec = (lit: string): number[] => JSON.parse(lit) as number[]

/** In-memory pg double that interprets SQL by leading keyword. */
class FakePg implements PgClient {
  rows = new Map<string, { embedding: number[]; metadata: Record<string, unknown> }>()
  created: string[] = []

  async query(text: string, params: unknown[] = []) {
    const head = text.trim().slice(0, 6).toUpperCase()
    if (head.startsWith('CREATE')) {
      this.created.push(text.trim())
      return { rows: [] }
    }
    if (head.startsWith('INSERT')) {
      const [id, vecLit, metaJson] = params as [string, string, string]
      this.rows.set(id, { embedding: parseVec(vecLit), metadata: JSON.parse(metaJson) })
      return { rows: [] }
    }
    if (head.startsWith('DELETE')) {
      this.rows.delete(params[0] as string)
      return { rows: [] }
    }
    if (head.startsWith('SELECT')) {
      const vec = parseVec(params[0] as string)
      const hasFilter = text.includes('@>')
      const filter = hasFilter ? (JSON.parse(params[1] as string) as Record<string, unknown>) : null
      const limit = (hasFilter ? params[2] : params[1]) as number
      const rows = [...this.rows.entries()]
        .filter(([, v]) => (filter ? Object.entries(filter).every(([k, val]) => v.metadata[k] === val) : true))
        .map(([id, v]) => ({ id, metadata: v.metadata, score: cosine(vec, v.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      return { rows }
    }
    return { rows: [] }
  }
  async end() {}
}

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]')
  })
})

describe('PgVectorAdapter', () => {
  let client: FakePg
  let adapter: PgVectorAdapter<{ source?: string }>

  beforeEach(() => {
    client = new FakePg()
    adapter = new PgVectorAdapter({ client, table: 'vecs' })
  })

  it('rejects an unsafe table name', () => {
    expect(() => new PgVectorAdapter({ client, table: 'bad; DROP TABLE x' })).toThrow(ValidationError)
  })

  it('upserts and queries, returning id, score, and metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    const results = await adapter.query([1, 0, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.score).toBeCloseTo(1)
    expect(results[0]?.metadata).toEqual({ source: 'wiki' })
  })

  it('ranks by cosine similarity', async () => {
    await adapter.upsert('near', [1, 0], { source: 'a' })
    await adapter.upsert('far', [0, 1], { source: 'b' })
    const results = await adapter.query([0.9, 0.1], 5)
    expect(results.map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('upsert replaces an existing id (ON CONFLICT)', async () => {
    await adapter.upsert('a', [1, 0], { source: 'v1' })
    await adapter.upsert('a', [0, 1], { source: 'v2' })
    const results = await adapter.query([0, 1], 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.metadata?.source).toBe('v2')
  })

  it('applies a jsonb containment filter', async () => {
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

  it('deletes a row', async () => {
    await adapter.upsert('a', [1, 0], {})
    await adapter.delete('a')
    expect(await adapter.query([1, 0], 5)).toHaveLength(0)
  })

  it('creates the extension and table on first use, inferring dimension', async () => {
    await adapter.upsert('a', [1, 2, 3, 4], {})
    expect(client.created.some((s) => /CREATE EXTENSION/i.test(s))).toBe(true)
    expect(client.created.some((s) => /vector\(4\)/.test(s))).toBe(true)
  })

  it('only ensures the schema once', async () => {
    const spy = vi.spyOn(client, 'query')
    await adapter.upsert('a', [1, 0], {})
    await adapter.upsert('b', [0, 1], {})
    const creates = spy.mock.calls.filter((c) => /^\s*CREATE/i.test(c[0] as string))
    expect(creates).toHaveLength(2) // extension + table, once total
  })

  it('respects an explicit vectorSize', async () => {
    adapter = new PgVectorAdapter({ client, table: 'vecs', vectorSize: 16 })
    await adapter.upsert('a', [1, 0], {})
    expect(client.created.some((s) => /vector\(16\)/.test(s))).toBe(true)
  })

  it('disconnect ends the pool', async () => {
    const spy = vi.spyOn(client, 'end')
    await adapter.disconnect()
    expect(spy).toHaveBeenCalledOnce()
  })

  describe('retry', () => {
    it('retries a transient failure then succeeds', async () => {
      let calls = 0
      const flaky: PgClient = {
        query: vi.fn(async (text: string, params?: unknown[]) => {
          calls++
          if (calls === 1) throw new Error('transient')
          return client.query(text, params)
        }),
        end: () => Promise.resolve(),
      }
      const a = new PgVectorAdapter({ client: flaky, table: 'vecs' })
      await expect(a.upsert('x', [1, 0], {})).resolves.toBeUndefined()
      expect(calls).toBeGreaterThan(1)
    })

    it('gives up after maxRetries', async () => {
      const broken: PgClient = {
        query: vi.fn().mockRejectedValue(new Error('down')),
        end: () => Promise.resolve(),
      }
      const a = new PgVectorAdapter({ client: broken, table: 'vecs', maxRetries: 2 })
      await expect(a.upsert('x', [1, 0], {})).rejects.toThrow('down')
    })
  })
})
