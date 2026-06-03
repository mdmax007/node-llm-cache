---
"@nodellmcache/pgvector": minor
---

Initial release of `@nodellmcache/pgvector`: a Postgres + pgvector `VectorStoreAdapter` (`upsert`/`query`/`delete`) for `@nodellmcache/semantic-cache` or standalone use. Manages an `(id, embedding vector, metadata jsonb)` table, upserts via `ON CONFLICT`, queries by cosine distance (`<=>`) returning cosine similarity as `score`, and filters via jsonb containment. Auto-creates the extension/table (dimension inferred or set), validates table identifiers, supports bounded retries and an injectable client. Unit-tested via an in-memory fake, with Docker-guarded integration tests.
