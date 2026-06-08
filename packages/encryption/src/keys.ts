import { randomBytes, scryptSync } from 'node:crypto'
import { ValidationError } from '@nodellmcache/core'

/** AES-256 needs a 32-byte key. */
export const KEY_BYTES = 32

/** Generates a fresh random 32-byte AES-256 key. Persist it somewhere safe. */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

/**
 * Derives a 32-byte key from a passphrase and salt using scrypt. Use a stable,
 * unique salt per deployment (store it alongside your config, not the data).
 */
export function deriveKey(passphrase: string, salt: string | Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES)
}

/**
 * Normalizes a key option into a 32-byte Buffer. Accepts a Buffer, a 64-char hex
 * string, or a 44-char base64 string.
 */
export function normalizeKey(key: Buffer | string): Buffer {
  let buf: Buffer
  if (Buffer.isBuffer(key)) {
    buf = key
  } else if (/^[0-9a-fA-F]{64}$/.test(key)) {
    buf = Buffer.from(key, 'hex')
  } else {
    buf = Buffer.from(key, 'base64')
  }
  if (buf.length !== KEY_BYTES) {
    throw new ValidationError(
      `Encryption key must be ${KEY_BYTES} bytes (got ${buf.length}). ` +
        'Use generateKey() or deriveKey(passphrase, salt).',
    )
  }
  return buf
}
