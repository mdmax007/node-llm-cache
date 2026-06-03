---
"@nodellmcache/embedding-cache": minor
---

Initial release of `@nodellmcache/embedding-cache`: an `EmbeddingCache` extending `BaseCacheManager` for vector embeddings. `getBatch` invokes the generator only for uncached inputs (deduplicated, first-seen order) and returns results in original input order; `getOrGenerate` handles the single-embedding case. Keys are namespaced by provider, model, and optional `dimensions`. Stats add `embeddingsReused` and `apiCallsAvoided` (cache reuse + intra-batch dedup). Storage adapter is injected.
