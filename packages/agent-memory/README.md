# @nodellmcache/agent-memory

Persistent, per-agent memory for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Gives AI agents long-term memory (episodic, semantic, procedural) plus transient working memory, isolated per agent and ranked on recall.

Memories live in an injected `StorageAdapter`, so backing it with `@nodellmcache/redis` gives memory that **survives restarts** and is shared across processes.

## Install

```bash
npm install @nodellmcache/agent-memory @nodellmcache/memory @nodellmcache/core @nodellmcache/semantic-cache
```

## Quick start

```ts
import { AgentMemory } from '@nodellmcache/agent-memory'
import { MemoryAdapter } from '@nodellmcache/memory'

const memory = new AgentMemory({ adapter: new MemoryAdapter() })
const agentId = 'assistant-001'

await memory.store(agentId, {
  type: 'semantic',
  content: 'User prefers concise answers without bullet points',
  importance: 0.9,
})
await memory.store(agentId, {
  type: 'episodic',
  content: 'User asked about Kubernetes on 2025-01-15',
  importance: 0.5,
})

const relevant = await memory.recall(agentId, 'formatting preferences')
console.log(relevant[0]?.content)

// Working (scratch) memory for the current task
await memory.storeWorking(agentId, { task: 'summarize docs', step: 2 })
const working = await memory.getWorkingMemory<{ task: string; step: number }>(agentId)
await memory.clearWorkingMemory(agentId)
```

## Recall ranking

- **Default (no `embeddingFn`)** — keyword overlap: the fraction of normalized query terms appearing in a memory's content, tie-broken by `importance` then recency.
- **Semantic (`embeddingFn` provided)** — memories are embedded at store time and recall ranks by cosine similarity (via `@nodellmcache/semantic-cache`). This is what makes "formatting preferences" recall "prefers concise answers".

```ts
const memory = new AgentMemory({
  adapter: new MemoryAdapter(),
  embeddingFn: (text) => embed(text), // your embedder
})
```

`recall(agentId, query, { limit, minScore, type })` returns ranked `MemoryItem`s; `minScore` filters by relevance, `type` restricts to one memory category.

## API

| Member | Description |
|--------|-------------|
| `store(agentId, { type, content, importance?, metadata? })` | Add a long-term memory; returns the item |
| `recall(agentId, query, opts?)` | Ranked retrieval of relevant memories |
| `forget(agentId, id)` | Remove a memory; returns whether it existed |
| `summarize(agentId, summarizer?)` | Built-in digest, or delegate to an LLM summarizer |
| `storeWorking` / `getWorkingMemory<W>` / `clearWorkingMemory` | Transient per-task state |
| `clear(agentId)` | Remove all of an agent's memory |

## Persistence

State is one record per agent in the adapter (`{namespace}{agentId}:memories` and `:working`). Use a persistent adapter to retain memory across restarts:

```ts
import { RedisAdapter } from '@nodellmcache/redis'
new AgentMemory({ adapter: new RedisAdapter({ host: 'localhost', port: 6379 }) })
```

## License

MIT
