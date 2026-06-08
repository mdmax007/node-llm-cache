/**
 * Encrypt cached values at rest with AES-256-GCM. No external services needed.
 *
 *   pnpm --filter @nodellmcache/examples encryption
 */
import { EncryptedAdapter, generateKey, type EncryptedBlob } from '@nodellmcache/encryption'
import { MemoryAdapter } from '@nodellmcache/memory'
import type { CacheEntry } from '@nodellmcache/core'

const key = generateKey() // persist this securely in real usage

// The inner adapter only ever sees encrypted envelopes.
const inner = new MemoryAdapter<EncryptedBlob>()
const store = new EncryptedAdapter<{ apiResponse: string }>({ adapter: inner, key })

const entry = (k: string, value: { apiResponse: string }): CacheEntry<{ apiResponse: string }> => ({
  key: k,
  value,
  createdAt: Date.now(),
  metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
})

async function main(): Promise<void> {
  await store.set('k', entry('k', { apiResponse: 'sensitive model output' }))

  // What actually sits in storage is ciphertext.
  const raw = await inner.get('k')
  console.log('stored envelope:', raw?.value)
  console.log('leaks plaintext?', JSON.stringify(raw?.value).includes('sensitive'))

  // Reading back through the encrypted adapter decrypts transparently.
  console.log('decrypted:', (await store.get('k'))?.value)

  // A wrong key cannot read it.
  const wrong = new EncryptedAdapter<{ apiResponse: string }>({ adapter: inner, key: generateKey() })
  try {
    await wrong.get('k')
  } catch (err) {
    console.log('wrong key rejected:', (err as Error).message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
