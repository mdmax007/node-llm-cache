/**
 * @nodellmcache/core: the building blocks — KeyBuilder, TTLManager, and a tiny
 * custom StorageAdapter. No external services needed.
 *
 *   pnpm --filter @nodellmcache/examples core
 */
import { KeyBuilder, TTLManager, type CacheEntry, type StorageAdapter, type AdapterStats } from '@nodellmcache/core'

// Keys are hashed and namespaced — raw prompt text never appears in the key.
const key = KeyBuilder.build('prompt', 'openai', 'gpt-4o', '  Hello   World  ')
console.log('key:', key)
console.log('normalized match:', key === KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world'))

// TTL arithmetic.
const createdAt = Date.now()
const expiresAt = TTLManager.computeExpiresAt(createdAt, 1000)
console.log('expiresAt set:', expiresAt !== undefined, '| expired now?', TTLManager.isExpired({ expiresAt }))

// Implementing the StorageAdapter contract is all it takes to add a backend.
class NaiveAdapter<T> implements StorageAdapter<T> {
  private map = new Map<string, CacheEntry<T>>()
  async get(k: string) {
    return this.map.get(k) ?? null
  }
  async set(k: string, entry: CacheEntry<T>) {
    this.map.set(k, entry)
  }
  async delete(k: string) {
    this.map.delete(k)
  }
  async clear() {
    this.map.clear()
  }
  async has(k: string) {
    return this.map.has(k)
  }
  async stats(): Promise<AdapterStats> {
    return { entryCount: this.map.size }
  }
}

async function main(): Promise<void> {
  const store = new NaiveAdapter<string>()
  await store.set(key, {
    key,
    value: 'cached answer',
    createdAt,
    metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
  })
  console.log('got back:', (await store.get(key))?.value)
  console.log('stats:', await store.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
