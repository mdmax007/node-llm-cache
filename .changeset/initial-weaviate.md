---
"@nodellmcache/weaviate": minor
---

Initial release of `@nodellmcache/weaviate`: a Weaviate `VectorStoreAdapter` (`upsert`/`query`/`delete`) built on the v3 `weaviate-client`, for `@nodellmcache/semantic-cache` or standalone use. Maps arbitrary string ids to deterministic UUIDs (preserving the original in object properties), auto-creates the collection with self-provided vectors, uses replace-on-upsert semantics, exposes `score = 1 - distance`, and supports metadata filtering, bounded retries, and an injectable store. Unit-tested via an in-memory fake, with Docker-guarded integration tests.
