---
"@nodellmcache/redis": minor
---

Initial release of `@nodellmcache/redis`: a Redis-backed `StorageAdapter` built on `ioredis`. Supports standalone, URL, Sentinel, and Cluster connections (or an injected client), Redis-native millisecond TTL (`PX`), key namespacing with safe `SCAN`-based `clear()`, `stats()` via `INFO` (`used_memory`/`evicted_keys`), optional per-entry compression (lazy-loaded or injected engine), and `ping()`/`disconnect()` health controls. Fully unit-tested via an injected client interface, with Docker-guarded integration tests.
