import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MilvusAdapter } from '../MilvusAdapter.js'

// Runs only when MILVUS_ADDRESS is set AND @zilliz/milvus2-sdk-node is installed,
// e.g. a Milvus standalone stack with MILVUS_ADDRESS=localhost:19530.
const ADDRESS = process.env.MILVUS_ADDRESS

describe.skipIf(!ADDRESS)('MilvusAdapter @integration', () => {
  const collection = `nodellmcache_test_${Date.now()}`
  let adapter: MilvusAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new MilvusAdapter<{ source: string }>({ address: ADDRESS, collection })
  })

  afterAll(async () => {
    await adapter.delete('a').catch(() => {})
    await adapter.delete('b').catch(() => {})
    await adapter.disconnect()
  })

  it('upserts, queries by similarity, and returns metadata', async () => {
    await adapter.upsert('a', [1, 0, 0], { source: 'wiki' })
    await adapter.upsert('b', [0, 1, 0], { source: 'blog' })
    await new Promise((r) => setTimeout(r, 1000)) // allow indexing
    const results = await adapter.query([0.9, 0.1, 0], 5)
    expect(results[0]?.id).toBe('a')
    expect(results[0]?.metadata?.source).toBe('wiki')
  })

  it('filters by metadata', async () => {
    const results = await adapter.query([1, 0, 0], 5, { source: 'blog' })
    expect(results.every((r) => r.metadata?.source === 'blog')).toBe(true)
  })
})
