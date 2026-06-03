# @nodellmcache/redis

Redis storage adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache), built on [`ioredis`](https://github.com/redis/ioredis). A drop-in `StorageAdapter` for any cache manager — swap it in for `@nodellmcache/memory` to get a shared, persistent, multi-process cache.

Supports standalone, URL, Sentinel, and Cluster connections, Redis-native TTL, key namespacing, and optional compression.

## Install

```bash
npm install @nodellmcache/redis @nodellmcache/core
# optional, only if you enable compression without injecting an engine:
npm install @nodellmcache/compression
```

## Quick start

```ts
import { PromptCache } from '@nodellmcache/prompt-cache'
import { RedisAdapter } from '@nodellmcache/redis'

const adapter = new RedisAdapter({ host: 'localhost', port: 6379 })
const cache = new PromptCache({ adapter })

// ... use the cache; remember to adapter.disconnect() on shutdown.
```

## Connection options

```ts
new RedisAdapter({ host: 'localhost', port: 6379, password, db })   // standalone
new RedisAdapter({ url: 'redis://:pass@host:6379/0' })              // URL
new RedisAdapter({ sentinels: [{ host, port }], name: 'mymaster' }) // Sentinel
new RedisAdapter({ cluster: [{ host, port }, { host, port }] })     // Cluster
new RedisAdapter({ client: existingIoredisInstance })              // inject your own
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `namespace` | `'nodellmcache:'` | Key prefix; `clear()` only touches these keys |
| `defaultTTL` | none | Fallback relative TTL (ms) |
| `compression` | `false` | `'auto'` \| `CompressionAlgo` \| `false`/`'none'` |
| `compressionEngine` | lazy-loaded | Inject a `CompressionEngine` to avoid the optional dep |
| `serializer` | `JsonSerializer` | Used when compression is enabled |
| `client` | constructed | Inject an existing `ioredis` (or compatible) client |

## Behavior

- **Storage** — each entry is a JSON envelope under `${namespace}${key}`. With compression enabled, the value is serialized, compressed, and base64-encoded into the envelope (the `'embedding'` cache type uses the lz4 hint).
- **TTL** — applied via Redis-native `SET ... PX <ms>`; precedence is `set` ttl arg → entry `expiresAt` → adapter `defaultTTL`. A read-time guard also drops logically-expired entries.
- **`clear()`** — `SCAN`s the namespace and deletes matched keys (never `FLUSHDB`), so it's safe on a shared Redis.
- **`stats()`** — `entryCount` via namespaced `SCAN`; `sizeBytes` (`used_memory`) and `evictions` (`evicted_keys`) from `INFO`.
- **`ping()` / `disconnect()`** — health check and graceful close.

## Testing

Unit tests run against an in-memory fake client (no Redis needed). Integration tests are tagged `@integration` and guarded:

```bash
docker compose up -d redis
REDIS_URL=redis://localhost:6379 pnpm --filter @nodellmcache/redis test
```

## License

MIT
