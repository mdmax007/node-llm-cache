# NodeLLMCache

A caching and memory layer built for AI apps in Node.js. Think of it as the thing that sits between your code and your LLM provider so you stop paying for the same answer twice.

## Why this exists

LLM calls are slow and they cost money. The annoying part is how often you ask for stuff you already have. The same prompt comes in again. The same text gets embedded for the hundredth time. Your RAG pipeline re-runs the exact retrieval it ran a second ago. Every one of those is real latency and real dollars going out the door for nothing.

Most people end up bolting on a half baked cache with a plain key value store, and then they discover the hard parts. Normalizing prompts so tiny differences still hit. Caching by meaning and not just exact text. Storing embeddings compactly. Knowing whether any of it actually saved money. NodeLLMCache does all of that so you do not have to write it again in every project.

## What it gives you

- **Prompt cache** so repeated prompts come back instantly for zero cost
- **Embedding cache** with batch dedup, so you only ever embed a given text once
- **Semantic cache** that matches on meaning, so "what is k8s" can hit the answer you cached for "explain kubernetes"
- **Retrieval and context caches** for RAG pipelines
- **Agent memory** with episodic, semantic, procedural and working memory per agent
- **Compression** that picks a codec for you, **observability** that tracks tokens and dollars saved, and a **live dashboard** to watch it happen
- **Pluggable storage** so the same code runs on in memory, Redis, or six different vector databases

Everything is pure Node. No native build steps, no node-gyp, works everywhere.

## Quick start

```bash
npm install @nodellmcache/prompt-cache @nodellmcache/memory @nodellmcache/core
```

```ts
import OpenAI from 'openai'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()
const cache = new PromptCache<string>({ adapter: new MemoryAdapter<string>() })

function ask(prompt: string) {
  return cache.getOrGenerate(
    prompt,
    async () => {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      })
      return res.choices[0]?.message.content ?? ''
    },
    { provider: 'openai', model: 'gpt-4o' },
  )
}

await ask('Explain Redis in one paragraph') // calls the API
await ask('Explain Redis in one paragraph') // free, instant, from cache

console.log(await cache.stats())
// { hits: 1, misses: 1, hitRate: 0.5, tokensSaved: 312, estimatedSavingsUSD: 0.0031 }
```

That is the whole idea. Wrap the expensive call, get the savings, see the numbers.

## A few more things you can do

Cache embeddings in batches and never embed the same text twice:

```ts
import { EmbeddingCache } from '@nodellmcache/embedding-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new EmbeddingCache({ adapter: new MemoryAdapter() })

// The generator only sees the texts that are not already cached, deduplicated.
const vectors = await cache.getBatch(['dog', 'cat', 'dog', 'bird', 'cat'], (uncached) =>
  embedThem(uncached),
)
```

Match on meaning instead of exact text:

```ts
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new SemanticCache<string>({
  similarityThreshold: 0.92,
  adapter: new MemoryAdapter<string>(),
  embeddingFn: (text) => embed(text),
})

await cache.getOrGenerate('What is Kubernetes?', () => askModel('What is Kubernetes?'))
const hit = await cache.getOrGenerate('Explain Kubernetes', () => askModel('Explain Kubernetes'))
console.log(hit.fromCache, hit.similarity) // true 0.94
```

Swap the storage backend without touching your app code. Same cache, now on Redis:

```ts
import { PromptCache } from '@nodellmcache/prompt-cache'
import { RedisAdapter } from '@nodellmcache/redis'

const cache = new PromptCache({ adapter: new RedisAdapter({ host: 'localhost', port: 6379 }) })
```

Or back a semantic cache with a real vector database:

```ts
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { QdrantAdapter } from '@nodellmcache/qdrant'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new SemanticCache({
  adapter: new MemoryAdapter(),
  embeddingFn: embed,
  vectorStore: new QdrantAdapter({ url: 'http://localhost:6333', collection: 'answers' }),
})
```

## Watch it work

Point your caches at the shared metrics collector and open the dashboard. It is a single dark, glowing page that streams live numbers, no setup beyond one import.

```ts
import { startDashboard } from '@nodellmcache/dashboard'
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new PromptCache({ adapter: new MemoryAdapter(), metrics: observability })
await startDashboard() // http://127.0.0.1:4242
```

You get a live hit rate ring and chart, tokens saved, dollars saved, latency, compression ratio, and a breakdown by cache type.

## The packages

Pick only what you need. Everything is published under the `@nodellmcache` scope.

| Package | What it is |
|---------|-----------|
| `core` | Shared interfaces, key builder, TTL, errors. Zero dependencies |
| `compression` | Brotli, LZ4 and Gzip with automatic codec selection |
| `memory` | In memory LRU adapter with TTL and optional compression |
| `prompt-cache` | LLM prompt and response caching with token and cost tracking |
| `embedding-cache` | Vector embedding caching with batch dedup |
| `semantic-cache` | Similarity based caching with a pluggable vector index |
| `retrieval-cache` | RAG retrieval and reranker caching with document aware invalidation |
| `context-cache` | Assembled context window caching |
| `agent-memory` | Persistent per agent memory, episodic, semantic, procedural, working |
| `observability` | Metrics, cost estimation and a live event bus |
| `dashboard` | The opt in real time metrics UI |
| `redis` | Redis storage adapter |
| `qdrant`, `pgvector`, `chroma`, `weaviate`, `pinecone`, `milvus` | Vector store adapters |

## How it is built

A few rules keep the whole thing consistent.

- Pure Node, no native bindings, so it installs and runs anywhere
- `core` has zero external dependencies and only holds the contracts
- Storage is backend agnostic, you inject an adapter and your business logic never imports it
- Cache keys are hashed, so raw prompt text never lands in a key
- Observability is built in, every cache operation can report what it saved

## Works with LangChain and LangGraph

Nothing special is needed in the core design. Our interfaces line up with the LangChain ones, so a thin adapter package can expose a `BaseCache` backed by the prompt or semantic cache, a `BaseStore` for cached embeddings, a `VectorStore` over any of the vector adapters, and a LangGraph checkpoint saver over the storage adapters. That integration package is on the roadmap.

## Status

The core platform is built and tested, from the cache primitives through compression, observability, storage adapters for Redis and six vector databases, agent memory, and the dashboard. A hosted docs site and the LangChain integration package are next.

## License

MIT
