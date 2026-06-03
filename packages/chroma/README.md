# @nodellmcache/chroma

[Chroma](https://www.trychroma.com) vector-store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Implements `VectorStoreAdapter`, so it plugs into `@nodellmcache/semantic-cache` or works standalone.

## Install

```bash
npm install @nodellmcache/chroma @nodellmcache/core chromadb
docker run -p 8000:8000 chromadb/chroma
```

## Quick start

```ts
import { ChromaAdapter } from '@nodellmcache/chroma'

const store = new ChromaAdapter<{ source: string }>({
  path: 'http://localhost:8000',
  collection: 'docs', // created on first use (cosine)
})

await store.upsert('doc-1', embedding, { source: 'wiki' })
const matches = await store.query(queryEmbedding, 5, { source: 'wiki' })
// → [{ id: 'doc-1', score: 0.94, metadata: { source: 'wiki' } }]
await store.delete('doc-1')
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `collection` | — (required) | Collection name (created on demand) |
| `path` | `http://localhost:8000` | Server URL (or pass `client`) |
| `space` | `cosine` | HNSW distance: `cosine` \| `l2` \| `ip` |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `client` | constructed | Inject an existing `chromadb` client (or compatible) |

## Notes

- **String ids** are supported natively (no remapping).
- **Scoring** is `1 - distance`; with the default `cosine` space that's cosine similarity (what `SemanticCache` expects).
- **Metadata filters** are flat equality; multiple keys are combined with Chroma's `$and`.

## Testing

```bash
docker run -p 8000:8000 chromadb/chroma
CHROMA_URL=http://localhost:8000 pnpm --filter @nodellmcache/chroma test
```

## License

MIT
