# @nodellmcache/tiered

## 1.0.0

### Minor Changes

- Initial release of `@nodellmcache/tiered`: a `TieredAdapter` that composes several `StorageAdapter`s (fastest first, e.g. memory + Redis) into one. Read-through walks tiers fastest-first and promotes a slower-tier hit back into the faster tiers; writes/deletes/clear go to every tier; expired entries are skipped; `stats()` aggregates across tiers. It is itself a `StorageAdapter`, so it drops into any cache manager.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
