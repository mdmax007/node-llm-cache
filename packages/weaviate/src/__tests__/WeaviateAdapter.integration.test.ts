import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WeaviateAdapter } from '../WeaviateAdapter.js'

// Runs only when WEAVIATE_HOST is set, e.g. WEAVIATE_HOST=localhost (HTTP 8080, gRPC 50051).
const HOST = process.env.WEAVIATE_HOST
const PORT = process.env.WEAVIATE_PORT ? Number(process.env.WEAVIATE_PORT) : undefined
const GRPC = process.env.WEAVIATE_GRPC ? Number(process.env.WEAVIATE_GRPC) : undefined

describe.skipIf(!HOST)('WeaviateAdapter @integration', () => {
  const collection = `Nodellmcache_test_${Date.now()}`
  let adapter: WeaviateAdapter<{ source: string }>

  beforeAll(() => {
    adapter = new WeaviateAdapter<{ source: string }>({ host: HOST, port: PORT, grpcPort: GRPC, collection })
  })

  afterAll(async () => {
    await adapter.delete('a').catch(() => {})
    await adapter.delete('b').catch(() => {})
    await adapter.disconnect()
  })

  it('upserts, queries by similarity, and restores ids + metadata', async () => {
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

  it('upsert replaces, and delete removes', async () => {
    await adapter.upsert('a', [0, 0, 1], { source: 'updated' })
    const updated = await adapter.query([0, 0, 1], 1)
    expect(updated[0]?.metadata?.source).toBe('updated')
    await adapter.delete('a')
    const after = await adapter.query([0, 0, 1], 5)
    expect(after.find((r) => r.id === 'a')).toBeUndefined()
  })
})
