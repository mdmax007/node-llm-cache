---
"@nodellmcache/qdrant": minor
---

Initial release of `@nodellmcache/qdrant`: a Qdrant-backed `VectorStoreAdapter` (`upsert`/`query`/`delete`) that plugs into `@nodellmcache/semantic-cache` or works standalone. Auto-creates the collection (cosine by default), maps arbitrary string ids to deterministic UUID point ids (preserving the original in the payload), supports flat metadata filtering, bounded retries, and an injectable client. Fully unit-tested via an in-memory fake client, with Docker-guarded integration tests.
