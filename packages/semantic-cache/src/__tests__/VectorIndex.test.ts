import { describe, it, expect } from 'vitest'
import { InMemoryVectorIndex, VectorStoreIndex } from '../VectorIndex.js'
import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'

describe('InMemoryVectorIndex', () => {
  it('returns null when empty', async () => {
    expect(await new InMemoryVectorIndex().search([1, 0])).toBeNull()
  })

  it('returns the most similar entry', async () => {
    const idx = new InMemoryVectorIndex()
    await idx.add('a', [1, 0], 'a-query')
    await idx.add('b', [0, 1], 'b-query')
    const match = await idx.search([0.9, 0.1])
    expect(match?.id).toBe('a')
    expect(match?.query).toBe('a-query')
    expect(match?.similarity).toBeGreaterThan(0.9)
  })

  it('removes and clears entries; size reflects state', async () => {
    const idx = new InMemoryVectorIndex()
    await idx.add('a', [1, 0], 'qa')
    await idx.add('b', [0, 1], 'qb')
    expect(idx.size()).toBe(2)
    await idx.remove('a')
    expect(idx.size()).toBe(1)
    await idx.clear()
    expect(idx.size()).toBe(0)
    expect(await idx.search([1, 0])).toBeNull()
  })
})

describe('VectorStoreIndex', () => {
  function makeStore() {
    const store = new Map<string, { vector: number[]; meta: { query: string } }>()
    const adapter: VectorStoreAdapter<{ query: string }> = {
      async upsert(id, vector, meta) {
        store.set(id, { vector, meta: meta ?? { query: '' } })
      },
      async query(_vector, topK): Promise<VectorMatch<{ query: string }>[]> {
        return [...store.entries()]
          .map(([id, e]) => ({ id, score: 0.95, metadata: e.meta }))
          .slice(0, topK)
      },
      async delete(id) {
        store.delete(id)
      },
    }
    return { store, adapter }
  }

  it('upserts and tracks size', async () => {
    const { adapter } = makeStore()
    const idx = new VectorStoreIndex(adapter)
    await idx.add('a', [1, 0], 'qa')
    expect(idx.size()).toBe(1)
  })

  it('maps a store match to an IndexMatch', async () => {
    const { adapter } = makeStore()
    const idx = new VectorStoreIndex(adapter)
    await idx.add('a', [1, 0], 'qa')
    const match = await idx.search([1, 0])
    expect(match).toEqual({ id: 'a', query: 'qa', similarity: 0.95 })
  })

  it('returns null when the store yields no matches', async () => {
    const { adapter } = makeStore()
    expect(await new VectorStoreIndex(adapter).search([1, 0])).toBeNull()
  })

  it('defaults query to empty string when metadata is missing', async () => {
    const adapter: VectorStoreAdapter<{ query: string }> = {
      async upsert() {},
      async query() {
        return [{ id: 'x', score: 0.99 }] as VectorMatch<{ query: string }>[]
      },
      async delete() {},
    }
    const match = await new VectorStoreIndex(adapter).search([1, 0])
    expect(match?.query).toBe('')
  })

  it('removes entries and decrements size (not below zero)', async () => {
    const { store, adapter } = makeStore()
    const idx = new VectorStoreIndex(adapter)
    await idx.add('a', [1, 0], 'qa')
    await idx.remove('a')
    expect(store.has('a')).toBe(false)
    expect(idx.size()).toBe(0)
    await idx.remove('a') // already gone
    expect(idx.size()).toBe(0)
  })

  it('clear() is a no-op that does not throw', async () => {
    const { adapter } = makeStore()
    await expect(new VectorStoreIndex(adapter).clear()).resolves.toBeUndefined()
  })
})
