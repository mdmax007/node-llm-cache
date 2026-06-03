# @nodellmcache/embedding-cache

Vector embedding caching for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Embeddings are deterministic for a given (text, model) pair, so they're the highest-ROI thing to cache — and re-embedding is pure wasted spend. This cache eliminates it, with first-class **batch** support.

The storage backend is **injected** — use `@nodellmcache/memory`, `@nodellmcache/redis`, or any `StorageAdapter`.

## Install

```bash
npm install @nodellmcache/embedding-cache @nodellmcache/memory @nodellmcache/core
```

## Quick start

```ts
import OpenAI from 'openai'
import { EmbeddingCache } from '@nodellmcache/embedding-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()
const cache = new EmbeddingCache({ adapter: new MemoryAdapter() })

// Single embedding
const embedding = await cache.getOrGenerate(
  'semantic search query',
  () =>
    openai.embeddings
      .create({ model: 'text-embedding-3-small', input: 'semantic search query' })
      .then((r) => r.data[0]!.embedding),
  { provider: 'openai', model: 'text-embedding-3-small' },
)

// Batch — the generator only sees texts not already cached, deduplicated.
const texts = ['dog', 'cat', 'dog', 'bird', 'cat']
const embeddings = await cache.getBatch(
  texts,
  (uncached) =>
    openai.embeddings
      .create({ model: 'text-embedding-3-small', input: uncached })
      .then((r) => r.data.map((d) => d.embedding)),
  { provider: 'openai', model: 'text-embedding-3-small' },
)
// API called once for ['dog', 'cat', 'bird']; results returned in input order.
```

## `getBatch` contract

- The `generator` receives **only uncached inputs**, **deduplicated**, in first-seen order, and must return embeddings in that same order.
- The returned array is aligned to the original `inputs` (duplicates included).
- A wrong-length generator result throws `ValidationError`.

## Keys

`embedding:{provider}:{model}:{sha256(text)}`. Pass `dimensions` to namespace models that support variable output sizes (e.g. `text-embedding-3-*`), so a 256-dim and a 1536-dim embedding of the same text never collide.

## Stats

```ts
const { hits, misses, hitRate, entryCount, embeddingsReused, apiCallsAvoided } = await cache.stats()
```

- `embeddingsReused` — embeddings served from cache (hits).
- `apiCallsAvoided` — `items requested − embeddings generated`, capturing both cache reuse **and** intra-batch dedup.

## Compact storage

Embeddings are stored as `number[]`. For a smaller footprint, give the cache a compression-enabled adapter — the `'embedding'` cache type automatically selects the lz4 hint in `@nodellmcache/memory`:

```ts
new EmbeddingCache({ adapter: new MemoryAdapter({ compression: 'auto' }) })
```

## License

MIT
