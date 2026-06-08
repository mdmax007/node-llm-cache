# @nodellmcache/context-cache

## 1.0.0

### Minor Changes

- 88ec6cd: Initial release of `@nodellmcache/context-cache`: a `ContextCache` extending `BaseCacheManager` that caches assembled LLM context windows. `getOrAssemble(query, documents, generator)` keys on the query plus an order-independent fingerprint of the contributing documents — each accepted as a bare id or `{ id, version }` so a version/content change busts the cache. Generic over the context value type; storage adapter injected.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
