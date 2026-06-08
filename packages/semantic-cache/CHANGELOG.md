# @nodellmcache/semantic-cache

## 1.0.0

### Minor Changes

- aace6f1: Initial release of `@nodellmcache/semantic-cache`: a `SemanticCache` that serves cached LLM responses by cosine similarity of the prompt embedding rather than exact text. Configurable `similarityThreshold` (default 0.92); `getOrGenerate` returns a `SemanticResult` (value + `fromCache` + `similarity` + `matchedQuery`); stats add `semanticHits`/`semanticHitRate`. Ships a pure-JS `cosineSimilarity`, an in-memory brute-force vector index (good to ~10k entries), and a pluggable `VectorStoreAdapter`-backed index for large-scale deployments. Storage adapter and `embeddingFn` are injected.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
