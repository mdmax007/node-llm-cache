import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { CacheAdapterError, JsonSerializer } from '@nodellmcache/core'
import type { AdapterStats, CacheEntry, Serializer, StorageAdapter } from '@nodellmcache/core'
import { normalizeKey } from './keys.js'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

/** The encrypted envelope stored in place of a value. */
export interface EncryptedBlob {
  v: 1
  iv: string
  tag: string
  data: string
}

export interface EncryptedAdapterOptions {
  /** Inner adapter that stores the encrypted envelopes (memory, Redis, ...). */
  adapter: StorageAdapter<EncryptedBlob>
  /** 32-byte key: a Buffer, 64-char hex, or base64. See `generateKey`/`deriveKey`. */
  key: Buffer | string
  /** Serializer used to turn values into bytes before encryption. Defaults to JSON. */
  serializer?: Serializer
}

/**
 * Wraps any {@link StorageAdapter} and encrypts cached **values** at rest with
 * AES-256-GCM (authenticated, so tampering is detected). Keys, timestamps, and
 * metadata are stored in the clear — only the value is encrypted, and cache keys
 * are already hashed by `KeyBuilder`, so no plaintext prompt content is exposed.
 *
 * Pure `node:crypto`, no native bindings.
 */
export class EncryptedAdapter<T = unknown> implements StorageAdapter<T> {
  private readonly inner: StorageAdapter<EncryptedBlob>
  private readonly key: Buffer
  private readonly serializer: Serializer

  constructor(options: EncryptedAdapterOptions) {
    this.inner = options.adapter
    this.key = normalizeKey(options.key)
    this.serializer = options.serializer ?? new JsonSerializer()
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    const stored = await this.inner.get(key)
    if (!stored) return null
    const value = this.decrypt(stored.value)
    return {
      key: stored.key,
      value,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
      metadata: stored.metadata,
    }
  }

  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    const stored: CacheEntry<EncryptedBlob> = {
      key: entry.key,
      value: this.encrypt(entry.value),
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      metadata: entry.metadata,
    }
    await this.inner.set(key, stored, ttl)
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key)
  }

  async clear(): Promise<void> {
    await this.inner.clear()
  }

  async has(key: string): Promise<boolean> {
    return this.inner.has(key)
  }

  async stats(): Promise<AdapterStats> {
    return this.inner.stats()
  }

  // --- crypto --------------------------------------------------------------

  private encrypt(value: T): EncryptedBlob {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const plaintext = this.serializer.serialize(value)
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') }
  }

  private decrypt(blob: EncryptedBlob): T {
    try {
      const decipher = createDecipheriv(ALGO, this.key, Buffer.from(blob.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(blob.data, 'base64')),
        decipher.final(),
      ])
      return this.serializer.deserialize<T>(plaintext)
    } catch (cause) {
      throw new CacheAdapterError(
        'Failed to decrypt cache entry (wrong key or tampered data)',
        { cause },
      )
    }
  }
}
