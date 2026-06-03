# @nodellmcache/memory

In-memory LRU storage adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). The Tier-0 "hot" backend: sub-millisecond reads, byte-budgeted LRU eviction, TTL expiry, and optional per-entry compression.

Implements `StorageAdapter<T>` from `@nodellmcache/core`, so any feature cache (prompt, embedding, semantic, …) can use it by injection.

## Install

```bash
npm install @nodellmcache/memory @nodellmcache/core
# only if you enable compression and don't inject your own engine:
npm install @nodellmcache/compression
```

## Quick start

```ts
import { MemoryAdapter } from '@nodellmcache/memory'

const store = new MemoryAdapter({
  maxSize: 256 * 1024 * 1024, // 256 MB; default is 500 MB
  defaultTTL: 3_600_000,      // 1 hour
})

await store.set('key', {
  key: 'key',
  value: { answer: 42 },
  createdAt: Date.now(),
  metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
})

const entry = await store.get('key') // { value: { answer: 42 }, ... } or null
```

Typically you don't call the adapter directly — you inject it into a cache manager:

```ts
import { PromptCache } from '@nodellmcache/prompt-cache'
const cache = new PromptCache({ adapter: new MemoryAdapter() })
```

## Behavior

- **LRU eviction** — entries are budgeted by an approximate byte size (`estimateSize`). When a `set` would exceed `maxSize`, least-recently-used entries are evicted (and a `cache.evict` metric is emitted). A read counts as recent use. A single value larger than `maxSize` is not stored.
- **TTL** — `set(key, entry, ttl)` takes a relative TTL in ms; otherwise the entry's own `expiresAt` or the adapter `defaultTTL` applies. Expiry is enforced both by a self-unref'ing timer and a defensive check on read.
- **Compression** *(optional)* — set `compression` to `'auto'` or a specific algorithm to serialize + compress each value (trading CPU for memory). The engine is lazily loaded from `@nodellmcache/compression`, or you can inject one:

  ```ts
  import { CompressionEngine } from '@nodellmcache/compression'
  new MemoryAdapter({ compression: 'auto', compressionEngine: new CompressionEngine() })
  ```

  > Compression serializes values (JSON by default), so non-JSON-safe types (e.g. `Float32Array`) round-trip as plain arrays. For binary embeddings, `@nodellmcache/embedding-cache` handles buffers directly.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxSize` | `500 MB` | Byte budget before LRU eviction |
| `defaultTTL` | none | Fallback relative TTL (ms) |
| `compression` | `false` | `'auto'` \| `CompressionAlgo` \| `false`/`'none'` |
| `compressionEngine` | lazy-loaded | Inject a `CompressionEngine` to avoid the optional dep |
| `serializer` | `JsonSerializer` | Used only when compression is enabled |
| `metrics` | no-op | Receives `cache.evict` events |

## `stats()`

```ts
const { entryCount, sizeBytes, evictions } = await store.stats()
```

## License

MIT
