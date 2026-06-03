import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PgVectorAdapter } from '../PgVectorAdapter.js'

const PG_URL = process.env.PGVECTOR_URL

// Runs only when PGVECTOR_URL is set, e.g.
//   docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 pgvector/pgvector:pg16
//   PGVECTOR_URL=postgres://postgres:pw@localhost:5432/postgres
describe.skipIf(!PG_URL)('PgVectorAdapter @integration', () => {
  const table = `nodellmcache_test_${Date.now()}`
  let adapter: PgVectorAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new PgVectorAdapter<{ source: string }>({ connectionString: PG_URL, table })
  })

  afterAll(async () => {
    await adapter.delete('a').catch(() => {})
    await adapter.delete('b').catch(() => {})
    await adapter.disconnect()
  })

  it('upserts, queries by cosine similarity, and returns metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    await adapter.upsert('b', [0, 1, 0], { source: 'blog' })
    const results = await adapter.query([0.9, 0.1, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.score).toBeGreaterThan(0.9)
    expect(results[0]?.metadata?.source).toBe('wiki')
  })

  it('filters by metadata', async () => {
    const results = await adapter.query([1, 0, 0], 5, { source: 'blog' })
    expect(results.every((r) => r.metadata?.source === 'blog')).toBe(true)
  })

  it('replaces on conflict and deletes', async () => {
    await adapter.upsert('a', [0, 0, 1], { source: 'updated' })
    const updated = await adapter.query([0, 0, 1], 1)
    expect(updated[0]?.metadata?.source).toBe('updated')
    await adapter.delete('a')
    const after = await adapter.query([0, 0, 1], 5)
    expect(after.find((r) => r.id === 'a')).toBeUndefined()
  })
})
