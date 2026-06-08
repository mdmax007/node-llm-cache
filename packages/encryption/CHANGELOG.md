# @nodellmcache/encryption

## 1.0.0

### Minor Changes

- Initial release of `@nodellmcache/encryption`: an `EncryptedAdapter` that wraps any `StorageAdapter` and encrypts cached values at rest with AES-256-GCM (authenticated; tampering is detected) using pure `node:crypto`. A fresh random IV is used per write; keys/timestamps/metadata stay in the clear (cache keys are already hashed). Includes `generateKey()` and `deriveKey(passphrase, salt)` helpers; accepts a 32-byte Buffer, hex, or base64 key. Wrong key or tampered data throws `CacheAdapterError`.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
