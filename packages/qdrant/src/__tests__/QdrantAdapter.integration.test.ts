import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { QdrantAdapter } from '../QdrantAdapter.js'

const QDRANT_URL = process.env.QDRANT_URL

// Runs only when QDRANT_URL is set (e.g. `docker compose up -d qdrant`).
describe.skipIf(!QDRANT_URL)('QdrantAdapter @integration', () => {
  const collection = `nodellmcache_test_${Date.now()}`
  let adapter: QdrantAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new QdrantAdapter<{ source: string }>({ url: QDRANT_URL, collection })
  })

  afterAll(async () => {
    // Best-effort cleanup of the test points.
    await adapter.delete('a').catch(() => {})
    await adapter.delete('b').catch(() => {})
  })

  it('upserts, queries by similarity, and restores ids + metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    await adapter.upsert('b', [0, 1, 0], { source: 'blog' })

    const results = await adapter.query([0.9, 0.1, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.metadata?.source).toBe('wiki')
  })

  it('filters by metadata', async () => {
    const results = await adapter.query([1, 0, 0], 5, { source: 'blog' })
    expect(results.every((r) => r.metadata?.source === 'blog')).toBe(true)
  })

  it('deletes a point', async () => {
    await adapter.delete('a')
    const results = await adapter.query([1, 0, 0], 5)
    expect(results.find((r) => r.id === 'a')).toBeUndefined()
  })
})
