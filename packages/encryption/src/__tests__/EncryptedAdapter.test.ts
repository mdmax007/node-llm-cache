import { describe, it, expect } from 'vitest'
import { EncryptedAdapter, generateKey, deriveKey, normalizeKey } from '../index.js'
import { MemoryAdapter } from '@nodellmcache/memory'
import { CacheAdapterError, ValidationError } from '@nodellmcache/core'
import type { CacheEntry } from '@nodellmcache/core'
import type { EncryptedBlob } from '../EncryptedAdapter.js'

function entryOf<T>(key: string, value: T): CacheEntry<T> {
  return {
    key,
    value,
    createdAt: Date.now(),
    metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
  }
}

describe('keys', () => {
  it('generateKey produces a 32-byte key', () => {
    expect(generateKey()).toHaveLength(32)
  })
  it('deriveKey is deterministic for the same passphrase + salt', () => {
    expect(deriveKey('hunter2', 'salt').equals(deriveKey('hunter2', 'salt'))).toBe(true)
    expect(deriveKey('hunter2', 'salt').equals(deriveKey('other', 'salt'))).toBe(false)
  })
  it('normalizeKey accepts Buffer, hex, and base64', () => {
    const k = generateKey()
    expect(normalizeKey(k).equals(k)).toBe(true)
    expect(normalizeKey(k.toString('hex')).equals(k)).toBe(true)
    expect(normalizeKey(k.toString('base64')).equals(k)).toBe(true)
  })
  it('normalizeKey rejects a wrong-length key', () => {
    expect(() => normalizeKey(Buffer.alloc(16))).toThrow(ValidationError)
  })
})

describe('EncryptedAdapter', () => {
  const key = generateKey()

  it('round-trips a value through encryption', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<{ secret: string }>({ adapter: inner, key })
    await enc.set('k', entryOf('k', { secret: 'top secret' }))
    expect((await enc.get('k'))?.value).toEqual({ secret: 'top secret' })
  })

  it('stores ciphertext, not plaintext, in the inner adapter', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key })
    await enc.set('k', entryOf('k', 'PLAINTEXT_MARKER'))
    const raw = await inner.get('k')
    expect(raw?.value).toMatchObject({ v: 1 })
    expect(JSON.stringify(raw?.value)).not.toContain('PLAINTEXT_MARKER')
  })

  it('preserves timestamps and metadata in the clear', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key })
    const entry = entryOf('k', 'v')
    await enc.set('k', entry)
    const raw = await inner.get('k')
    expect(raw?.metadata.cacheType).toBe('prompt')
    expect(raw?.createdAt).toBe(entry.createdAt)
  })

  it('returns null on a miss', async () => {
    const enc = new EncryptedAdapter<string>({ adapter: new MemoryAdapter<EncryptedBlob>(), key })
    expect(await enc.get('nope')).toBeNull()
  })

  it('fails to decrypt with the wrong key', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    await new EncryptedAdapter<string>({ adapter: inner, key }).set('k', entryOf('k', 'v'))
    const wrong = new EncryptedAdapter<string>({ adapter: inner, key: generateKey() })
    await expect(wrong.get('k')).rejects.toThrow(CacheAdapterError)
  })

  it('detects tampering (GCM auth tag)', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key })
    await enc.set('k', entryOf('k', 'v'))
    const raw = (await inner.get('k'))!
    // Flip the ciphertext.
    const tampered = Buffer.from(raw.value.data, 'base64')
    tampered[0] = tampered[0]! ^ 0xff
    raw.value.data = tampered.toString('base64')
    await inner.set('k', raw)
    await expect(enc.get('k')).rejects.toThrow(CacheAdapterError)
  })

  it('uses a fresh IV per write (same value -> different ciphertext)', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key })
    await enc.set('a', entryOf('a', 'same'))
    const a = (await inner.get('a'))!.value
    await enc.set('b', entryOf('b', 'same'))
    const b = (await inner.get('b'))!.value
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('delegates delete/clear/has/stats to the inner adapter', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key })
    await enc.set('k', entryOf('k', 'v'))
    expect(await enc.has('k')).toBe(true)
    expect((await enc.stats()).entryCount).toBe(1)
    await enc.delete('k')
    expect(await enc.has('k')).toBe(false)
    await enc.set('x', entryOf('x', '1'))
    await enc.clear()
    expect((await enc.stats()).entryCount).toBe(0)
  })

  it('accepts a hex string key', async () => {
    const inner = new MemoryAdapter<EncryptedBlob>()
    const enc = new EncryptedAdapter<string>({ adapter: inner, key: key.toString('hex') })
    await enc.set('k', entryOf('k', 'v'))
    expect((await enc.get('k'))?.value).toBe('v')
  })
})
