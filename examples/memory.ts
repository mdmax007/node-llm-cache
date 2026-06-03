/**
 * @nodellmcache/memory: the in-memory LRU adapter on its own — TTL, eviction,
 * stats, and optional compression. No external services.
 *
 *   pnpm --filter @nodellmcache/examples memory
 */
import { MemoryAdapter } from '@nodellmcache/memory'
import type { CacheEntry } from '@nodellmcache/core'

function entry<T>(key: string, value: T, ttl?: number): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    ...(ttl ? { expiresAt: Date.now() + ttl } : {}),
    metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
  }
}

async function main(): Promise<void> {
  // Tiny budget so we can watch LRU eviction happen.
  const store = new MemoryAdapter<string>({ maxSize: 120 })

  await store.set('a', entry('a', 'x'.repeat(40)))
  await store.set('b', entry('b', 'y'.repeat(40)))
  await store.get('a') // touch 'a' so it is most-recently-used
  await store.set('c', entry('c', 'z'.repeat(40))) // over budget -> evicts LRU ('b')

  console.log('has a:', await store.has('a'), '| has b:', await store.has('b'), '| has c:', await store.has('c'))
  console.log('stats:', await store.stats()) // entryCount, sizeBytes, evictions

  // Optional per-entry compression (lazy-loads @nodellmcache/compression).
  const compressed = new MemoryAdapter<{ text: string }>({ compression: 'auto' })
  const value = { text: 'compress me '.repeat(200) }
  await compressed.set('big', entry('big', value))
  console.log('compressed round-trip:', JSON.stringify((await compressed.get('big'))?.value) === JSON.stringify(value))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
