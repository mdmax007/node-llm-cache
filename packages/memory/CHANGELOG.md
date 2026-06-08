# @nodellmcache/memory

## 1.0.0

### Minor Changes

- f38cbec: Initial release of `@nodellmcache/memory`: an in-memory `MemoryAdapter` implementing `StorageAdapter`, with byte-budgeted LRU eviction (configurable `maxSize`, default 500 MB), TTL via self-unref'ing timers plus a read-time expiry check, optional per-entry compression (lazy-loaded or injected `CompressionEngine`), and `stats()` reporting entry count, size, and evictions.

### Patch Changes

- Updated dependencies [f38cbec]
- Updated dependencies [a2633d8]
  - @nodellmcache/compression@1.0.0
  - @nodellmcache/core@1.0.0
