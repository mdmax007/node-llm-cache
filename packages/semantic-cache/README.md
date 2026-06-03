# @nodellmcache/semantic-cache

Similarity-based LLM response caching for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Instead of requiring an exact prompt match, it embeds each query and serves a cached response when a previous query is **semantically close enough** — so "What is Kubernetes?" can hit the answer cached for "Explain Kubernetes".

## Install

```bash
npm install @nodellmcache/semantic-cache @nodellmcache/memory @nodellmcache/core
```

## Quick start

```ts
import OpenAI from 'openai'
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()

const cache = new SemanticCache<string>({
  similarityThreshold: 0.92, // default
  adapter: new MemoryAdapter<string>(),
  embeddingFn: (text) =>
    openai.embeddings
      .create({ model: 'text-embedding-3-small', input: text })
      .then((r) => r.data[0]!.embedding),
})

const generate = (prompt: string) =>
  openai.chat.completions
    .create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] })
    .then((r) => r.choices[0]!.message.content ?? '')

await cache.getOrGenerate('What is Kubernetes?', () => generate('What is Kubernetes?'))

const result = await cache.getOrGenerate('Explain Kubernetes', () => generate('Explain Kubernetes'))
result.fromCache    // true
result.similarity   // ~0.94
result.matchedQuery // 'What is Kubernetes?'
result.value        // the reused response
```

## How it works

1. The query is embedded via your `embeddingFn`.
2. The embedding is compared (cosine) against previously seen queries.
3. If the best match ≥ `similarityThreshold`, the stored response is returned (`fromCache: true`); otherwise the generator runs and the result is stored and indexed.

The similarity index is separate from the response store (the adapter). If a stored response has expired or been evicted, the lookup falls back to a miss and the stale index entry is dropped.

## Stats

```ts
const { hits, misses, hitRate, entryCount, semanticHits, semanticHitRate } = await cache.stats()
```

- `semanticHits` — hits that matched a **different** query (true fuzzy reuse), as opposed to an exact repeat.

## Scaling: pluggable vector store

The default index is an **in-memory brute-force scan** — O(n) per lookup. Measured on Node 22 (1536-dim vectors):

| Index size | Search latency | Throughput |
|------------|---------------|-----------|
| 100 | ~0.09 ms | ~11,000 ops/s |
| 1,000 | ~0.9 ms | ~1,100 ops/s |
| 10,000 | ~13 ms | ~76 ops/s |

Comfortable to ~10k entries. Beyond that, inject a `VectorStoreAdapter` (Qdrant, pgvector, …) that scores by cosine:

```ts
new SemanticCache({ adapter, embeddingFn, vectorStore: myQdrantAdapter })
```

## Notes

- **One instance per model.** The similarity index keys on the query embedding, not the generation model, so a single `SemanticCache` should serve a single logical model/use-case. Use separate instances (or separate adapters) per model to avoid serving one model's response for another's request.
- `embeddingFn` is injected — wrap it with `@nodellmcache/embedding-cache` to also cache the query embeddings themselves.

## License

MIT
