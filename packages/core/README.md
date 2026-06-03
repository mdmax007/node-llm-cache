# @nodellmcache/core

Shared interfaces, types, and utilities for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache) — AI memory infrastructure for Node.js.

This is the central package every other `@nodellmcache/*` package depends on. It has **zero external dependencies** and exports only contracts and small, pure utilities. You rarely install it directly; a feature package (e.g. `@nodellmcache/prompt-cache`) pulls it in.

## Install

```bash
npm install @nodellmcache/core
```

## What's inside

- **Interfaces** — `StorageAdapter`, `VectorStoreAdapter`, `CompressionEngine`, `CacheEntry`, `CacheMetadata`, `MetricsSink`, `CacheOptions`
- **Types** — `CacheType`, `LLMProvider`, `CompressionAlgo`, `DataHint`
- **`KeyBuilder`** — deterministic, hashed cache keys
- **`TTLManager`** — expiry arithmetic and sliding windows
- **`Serializer` / `JsonSerializer`** — pluggable value encoding
- **`BaseCacheManager`** — the cache-aside base class for every feature cache
- **Error hierarchy** — `NodeLLMCacheError` and typed subclasses

## Quick start

### Building keys

Keys follow the format `{type}:{provider}:{model}:{sha256}`. The raw input is normalized (`trim` → `toLowerCase` → collapse whitespace) and hashed, so **raw prompt text never appears in a key**.

```ts
import { KeyBuilder } from '@nodellmcache/core'

KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'Hello   World')
// 'prompt:openai:gpt-4o:<sha256-of "hello world">'
```

### Implementing a storage adapter

```ts
import type { StorageAdapter, CacheEntry, AdapterStats } from '@nodellmcache/core'

class MyAdapter<T> implements StorageAdapter<T> {
  async get(key: string): Promise<CacheEntry<T> | null> { /* ... */ }
  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> { /* ... */ }
  async delete(key: string): Promise<void> { /* ... */ }
  async clear(): Promise<void> { /* ... */ }
  async has(key: string): Promise<boolean> { /* ... */ }
  async stats(): Promise<AdapterStats> { /* ... */ }
}
```

### Building a feature cache

`BaseCacheManager` provides the cache-aside `getOrGenerate` flow, key building, TTL handling, hit/miss accounting, and metric emission. Subclasses only declare their `cacheType`.

```ts
import { BaseCacheManager } from '@nodellmcache/core'

class PromptCache extends BaseCacheManager<string> {
  protected readonly cacheType = 'prompt' as const
}

const cache = new PromptCache({ adapter: myAdapter, defaultTTL: 3_600_000 })

const answer = await cache.getOrGenerate(
  'Explain Redis in one paragraph',
  () => callTheModel(),
  { provider: 'openai', model: 'gpt-4o' },
)
```

## API summary

| Symbol | Kind | Purpose |
|--------|------|---------|
| `KeyBuilder.build/normalize/hash` | class (static) | Cache key generation |
| `TTLManager.computeExpiresAt/isExpired/remaining/slide` | class (static) | TTL arithmetic |
| `JsonSerializer` | class | Default JSON value codec (implements `Serializer`) |
| `BaseCacheManager` | abstract class | Cache-aside base for feature caches |
| `StorageAdapter<T>` | interface | Backend contract |
| `VectorStoreAdapter<M>` | interface | Vector DB contract |
| `CompressionEngine` | interface | Compression contract |
| `MetricsSink` | interface | Metrics emission contract |
| `NodeLLMCacheError` + subclasses | classes | Typed error hierarchy |

## Notes

- The architecture specifies MessagePack as the primary serialization format. To keep `core` dependency-free, this package ships only `JsonSerializer`; a MessagePack `Serializer` can be supplied by an optional package and injected wherever a `Serializer` is accepted.
- `MetricsSink` defaults to a no-op (`noopMetrics`). Wire in `@nodellmcache/observability` to collect real metrics.

## License

MIT
