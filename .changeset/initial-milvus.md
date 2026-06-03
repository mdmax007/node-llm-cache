---
"@nodellmcache/milvus": minor
---

Initial release of `@nodellmcache/milvus`: a Milvus `VectorStoreAdapter` (`upsert`/`query`/`delete`) for `@nodellmcache/semantic-cache` or standalone use. Creates the collection on demand (VarChar id, FloatVector, JSON metadata; AUTOINDEX with cosine), uses native string ids, exposes cosine similarity as `score`, and supports flat metadata filtering, bounded retries, and an injectable store. `@zilliz/milvus2-sdk-node` is an optional peer dependency, lazily imported. Unit-tested via an in-memory fake; integration tests are env-guarded.
