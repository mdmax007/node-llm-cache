# @nodellmcache/weaviate

## 1.0.0

### Minor Changes

- 949a2b1: Initial release of `@nodellmcache/weaviate`: a Weaviate `VectorStoreAdapter` (`upsert`/`query`/`delete`) built on the v3 `weaviate-client`, for `@nodellmcache/semantic-cache` or standalone use. Maps arbitrary string ids to deterministic UUIDs (preserving the original in object properties), auto-creates the collection with self-provided vectors, uses replace-on-upsert semantics, exposes `score = 1 - distance`, and supports metadata filtering, bounded retries, and an injectable store. Unit-tested via an in-memory fake, with Docker-guarded integration tests.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
