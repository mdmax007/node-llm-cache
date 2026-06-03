import { describe, it, expect, beforeAll } from 'vitest'
import { PineconeAdapter } from '../PineconeAdapter.js'

// Runs only with real credentials + an existing (cosine) index:
//   PINECONE_API_KEY=... PINECONE_INDEX=my-index
const API_KEY = process.env.PINECONE_API_KEY
const INDEX = process.env.PINECONE_INDEX

describe.skipIf(!API_KEY || !INDEX)('PineconeAdapter @integration', () => {
  let adapter: PineconeAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new PineconeAdapter<{ source: string }>({
      apiKey: API_KEY,
      index: INDEX!,
      namespace: `nodellmcache-test-${Date.now()}`,
    })
  })

  it('upserts, queries by similarity, and returns metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    await adapter.upsert('b', [0, 1, 0], { source: 'blog' })
    // Pinecone is eventually consistent; allow a brief settle.
    await new Promise((r) => setTimeout(r, 3000))
    const results = await adapter.query([0.9, 0.1, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.metadata?.source).toBe('wiki')
  })

  it('deletes a vector', async () => {
    await adapter.delete('a')
  })
})
