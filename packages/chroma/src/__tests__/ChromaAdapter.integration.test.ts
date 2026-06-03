import { describe, it, expect, beforeAll } from 'vitest'
import { ChromaAdapter } from '../ChromaAdapter.js'

const CHROMA_URL = process.env.CHROMA_URL

// Runs only when CHROMA_URL is set, e.g. `docker run -p 8000:8000 chromadb/chroma`.
describe.skipIf(!CHROMA_URL)('ChromaAdapter @integration', () => {
  const collection = `nodellmcache_test_${Date.now()}`
  let adapter: ChromaAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new ChromaAdapter<{ source: string }>({ path: CHROMA_URL, collection })
  })

  it('upserts, queries by similarity, and returns metadata', async () => {
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

  it('deletes a point', async () => {
    await adapter.delete('a')
    const results = await adapter.query([1, 0, 0], 5)
    expect(results.find((r) => r.id === 'a')).toBeUndefined()
  })
})
