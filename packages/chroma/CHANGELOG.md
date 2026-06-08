# @nodellmcache/chroma

## 1.0.0

### Minor Changes

- 949a2b1: Initial release of `@nodellmcache/chroma`: a Chroma `VectorStoreAdapter` (`upsert`/`query`/`delete`) for `@nodellmcache/semantic-cache` or standalone use. Uses native string ids, auto-creates the collection (cosine by default), exposes `score = 1 - distance`, and supports flat metadata filtering (combined with `$and`), bounded retries, and an injectable client. Unit-tested via an in-memory fake, with Docker-guarded integration tests.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
