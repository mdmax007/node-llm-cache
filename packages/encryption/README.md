# @nodellmcache/encryption

Encrypting storage adapter wrapper for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Wraps any `StorageAdapter` and encrypts cached **values** at rest with AES-256-GCM (authenticated, so tampering is detected). Pure `node:crypto`, no native bindings.

## Install

```bash
npm install @nodellmcache/encryption @nodellmcache/core
```

## Quick start

```ts
import { PromptCache } from '@nodellmcache/prompt-cache'
import { EncryptedAdapter, generateKey } from '@nodellmcache/encryption'
import { RedisAdapter } from '@nodellmcache/redis'

const key = generateKey() // 32 bytes; persist this securely (env/secret manager)

const adapter = new EncryptedAdapter({
  adapter: new RedisAdapter({ host: 'localhost', port: 6379 }),
  key,
})

const cache = new PromptCache({ adapter })
```

Derive a key from a passphrase instead:

```ts
import { deriveKey } from '@nodellmcache/encryption'
const key = deriveKey(process.env.CACHE_PASSPHRASE!, process.env.CACHE_SALT!)
```

## What is and isn't encrypted

- **Encrypted**: the cached value (serialized, then AES-256-GCM with a fresh random IV per write).
- **In the clear**: the cache key, timestamps, and metadata (sizes, cache type, model). Cache keys are already SHA-256 hashed by `KeyBuilder`, so no plaintext prompt content is exposed either way.

## Notes

- The key must be 32 bytes. Pass a `Buffer`, a 64-char hex string, or base64. `generateKey()` makes one; `deriveKey(passphrase, salt)` derives one via scrypt.
- Decryption with the wrong key, or against tampered data, throws `CacheAdapterError` (the GCM auth tag fails).
- It is a `StorageAdapter`, so it composes with anything, including `@nodellmcache/tiered`.

## License

MIT
