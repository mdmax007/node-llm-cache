---
"@nodellmcache/memory": minor
---

Initial release of `@nodellmcache/memory`: an in-memory `MemoryAdapter` implementing `StorageAdapter`, with byte-budgeted LRU eviction (configurable `maxSize`, default 500 MB), TTL via self-unref'ing timers plus a read-time expiry check, optional per-entry compression (lazy-loaded or injected `CompressionEngine`), and `stats()` reporting entry count, size, and evictions.
