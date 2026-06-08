# @nodellmcache/tiered

Multi-tier storage adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Compose several `StorageAdapter`s into one, fastest first, with read-through promotion and write-through. The classic setup is L1 in-process memory plus L2 Redis: microsecond hits when hot, a shared durable tier when not.

## Install

```bash
npm install @nodellmcache/tiered @nodellmcache/core
```

## Quick start

```ts
import { PromptCache } from '@nodellmcache/prompt-cache'
import { TieredAdapter } from '@nodellmcache/tiered'
import { MemoryAdapter } from '@nodellmcache/memory'
import { RedisAdapter } from '@nodellmcache/redis'

const adapter = new TieredAdapter({
  tiers: [
    new MemoryAdapter({ maxSize: 64 * 1024 * 1024 }), // L1: fast, local
    new RedisAdapter({ host: 'localhost', port: 6379 }), // L2: shared, durable
  ],
})

const cache = new PromptCache({ adapter })
```

## Behavior

- **Read-through with promotion** — `get` walks the tiers fastest-first. On a hit in a slower tier, the entry is back-filled into the faster tiers that missed, so the next read is quick.
- **Write-through** — `set`, `delete`, and `clear` apply to every tier.
- **Expiry** — expired entries are skipped while walking tiers.
- **`stats()`** — `entryCount` is the max across tiers (writes are mirrored), `sizeBytes` and `evictions` are summed across tiers that report them.

Tiers are just `StorageAdapter`s, so any combination works (memory + Redis, Redis + Postgres, three tiers, etc.). It is a `StorageAdapter` itself, so it drops into any cache manager.

## License

MIT
