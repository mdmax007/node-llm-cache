# @nodellmcache/pinecone

## 1.0.0

### Minor Changes

- 949a2b1: Initial release of `@nodellmcache/pinecone`: a Pinecone `VectorStoreAdapter` (`upsert`/`query`/`delete`) for `@nodellmcache/semantic-cache` or standalone use. Targets an existing (cosine) index, uses native string ids, returns the index score directly, supports namespaces, `$eq` metadata filtering, bounded retries, and an injectable index handle. Unit-tested via an in-memory fake; integration tests are credential-guarded.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
