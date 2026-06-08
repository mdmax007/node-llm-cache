# @nodellmcache/qdrant

## 1.0.0

### Minor Changes

- 949a2b1: Initial release of `@nodellmcache/qdrant`: a Qdrant-backed `VectorStoreAdapter` (`upsert`/`query`/`delete`) that plugs into `@nodellmcache/semantic-cache` or works standalone. Auto-creates the collection (cosine by default), maps arbitrary string ids to deterministic UUID point ids (preserving the original in the payload), supports flat metadata filtering, bounded retries, and an injectable client. Fully unit-tested via an in-memory fake client, with Docker-guarded integration tests.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
