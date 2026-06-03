# @nodellmcache/retrieval-cache

RAG retrieval & reranker caching for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Caches the documents a retriever returns for a query — and a reranker's output for a candidate set — so repeated or similar requests skip the vector search / rerank round-trips. Retriever-agnostic: works with Qdrant, pgvector, Pinecone, or anything you call.

## Install

```bash
npm install @nodellmcache/retrieval-cache @nodellmcache/memory @nodellmcache/core
```

## Quick start

```ts
import { RetrievalCache, type RetrievedDocument } from '@nodellmcache/retrieval-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new RetrievalCache({
  adapter: new MemoryAdapter<RetrievedDocument[]>(),
  defaultTTL: 5 * 60 * 1000, // freshness window
})

// Cache vector-search results.
const results = await cache.getOrGenerate('best practices for caching', async () => {
  const hits = await vectorDb.search(/* ... */)
  return hits.map((h) => ({ id: h.id, score: h.score, content: h.text }))
})

// Cache reranker output (keyed by query + the candidate set).
const reranked = await cache.getOrRerank('best practices', results, async () => {
  return reranker.rerank('best practices', results)
})
```

## Document-aware invalidation

When a document changes, evict exactly the cached results that contain it:

```ts
const removed = await cache.invalidateByDocument('doc-42') // returns # entries evicted
```

A reverse index (document id → cache keys) is maintained as results are cached. It's **in-process**, so invalidation is best-effort when a shared/persistent adapter is used across multiple processes; pair with TTL freshness for those deployments.

## API

| Member | Description |
|--------|-------------|
| `getOrGenerate(query, gen, opts?)` | Cache retrieval results (`RetrievedDocument[]` or your `D[]`) |
| `getOrRerank(query, inputDocs, gen, opts?)` | Cache reranker output, keyed by query + input set (order-independent) |
| `invalidateByDocument(id)` | Evict all cached results containing a document |
| `stats()` | hits / misses / hitRate / entryCount |

Generic over the document type: `new RetrievalCache<MyDoc>(...)` where `MyDoc extends { id: string }`.

## License

MIT
