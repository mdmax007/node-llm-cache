# @nodellmcache/context-cache

Assembled context-window caching for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Assembling a context — selecting, ordering, trimming, and formatting retrieved documents into the prompt window — is repeated work in RAG pipelines. This caches the assembled result, keyed by the query and the exact documents (and versions) that went into it.

## Install

```bash
npm install @nodellmcache/context-cache @nodellmcache/memory @nodellmcache/core
```

## Quick start

```ts
import { ContextCache } from '@nodellmcache/context-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new ContextCache<string>({ adapter: new MemoryAdapter<string>() })

const context = await cache.getOrAssemble(
  'How do I configure TLS?',
  ['doc-12', 'doc-87', 'doc-90'], // contributing document ids
  async () => assembleContext(query, documents), // your (expensive) assembly
)
```

## Cache keys & versioning

The key is the query plus an **order-independent** fingerprint of the contributing documents. Pass versions so the cache busts when a document changes:

```ts
await cache.getOrAssemble('q', [
  { id: 'doc-12', version: 3 },
  { id: 'doc-87', version: 'a1b2' }, // a content hash works too
], assemble)
```

- Same query + same docs + same versions → **hit**.
- Any change to the doc set, ordering aside, or any version → **miss** (rebuilt).
- A bare `'doc-12'` and `{ id: 'doc-12' }` are equivalent; `{ id: 'doc-12', version: ... }` is distinct.

## API

| Member | Description |
|--------|-------------|
| `getOrAssemble(query, docs, gen, opts?)` | Cache the assembled context (`T`, defaults to `string`) |
| `invalidateAssembled(query, docs, opts?)` | Drop a specific assembled context |
| `stats()` | hits / misses / hitRate / entryCount |

`ContextCache<T>` lets you cache structured contexts (e.g. `{ text, tokens }`), not just strings.

## License

MIT
