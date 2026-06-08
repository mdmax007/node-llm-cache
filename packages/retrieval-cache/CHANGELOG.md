# @nodellmcache/retrieval-cache

## 1.0.0

### Minor Changes

- 88ec6cd: Initial release of `@nodellmcache/retrieval-cache`: a `RetrievalCache` extending `BaseCacheManager` for RAG. Caches retrieval results (query → documents) via `getOrGenerate` and reranker outputs via `getOrRerank` (keyed by query + an order-independent fingerprint of the candidate set). Adds document-aware invalidation: `invalidateByDocument(id)` evicts exactly the cached results containing a changed document, backed by an in-process reverse index. Generic over the document type (`D extends { id: string }`). Storage adapter injected.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
