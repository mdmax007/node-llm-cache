---
"@nodellmcache/retrieval-cache": minor
---

Initial release of `@nodellmcache/retrieval-cache`: a `RetrievalCache` extending `BaseCacheManager` for RAG. Caches retrieval results (query → documents) via `getOrGenerate` and reranker outputs via `getOrRerank` (keyed by query + an order-independent fingerprint of the candidate set). Adds document-aware invalidation: `invalidateByDocument(id)` evicts exactly the cached results containing a changed document, backed by an in-process reverse index. Generic over the document type (`D extends { id: string }`). Storage adapter injected.
