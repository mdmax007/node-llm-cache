# @nodellmcache/qdrant

[Qdrant](https://qdrant.tech) vector-store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Implements the `VectorStoreAdapter` contract, so it plugs straight into `@nodellmcache/semantic-cache` (as its `vectorStore`) for large-scale similarity search — or use it directly for vector upsert/query/delete.

## Install

```bash
npm install @nodellmcache/qdrant @nodellmcache/core
```

## Quick start

```bash
docker compose up -d qdrant   # or: docker run -p 6333:6333 qdrant/qdrant
```

```ts
import { QdrantAdapter } from '@nodellmcache/qdrant'

const store = new QdrantAdapter<{ source: string }>({
  url: 'http://localhost:6333',
  collection: 'docs', // created automatically on first use (cosine)
})

await store.upsert('doc-1', embedding, { source: 'wiki' })

const matches = await store.query(queryEmbedding, 5, { source: 'wiki' }) // optional metadata filter
// → [{ id: 'doc-1', score: 0.94, metadata: { source: 'wiki' } }, ...]

await store.delete('doc-1')
```

## With SemanticCache

```ts
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { QdrantAdapter } from '@nodellmcache/qdrant'

const cache = new SemanticCache({
  adapter,          // response store (memory/redis)
  embeddingFn,      // your embedder
  vectorStore: new QdrantAdapter({ url: 'http://localhost:6333', collection: 'semantic' }),
})
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `collection` | — (required) | Target collection name |
| `url` / `host`+`port` | `localhost:6333` | Connection (or pass `client`) |
| `apiKey` | — | For Qdrant Cloud / secured instances |
| `vectorSize` | inferred | Dimensionality; inferred from the first upserted vector |
| `distance` | `Cosine` | `Cosine` \| `Dot` \| `Euclid` for auto-created collections |
| `idKey` | `'__id'` | Payload key that round-trips the original string id |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `client` | constructed | Inject an existing `@qdrant/js-client-rest` (or compatible) client |

## Notes

- **Arbitrary string ids** are supported: Qdrant only accepts integer/UUID ids, so each id is mapped to a deterministic UUID point id and the original is preserved in the payload (`idKey`) and restored on query.
- **Collections are created on demand** with the configured distance (cosine by default) — set `vectorSize` to create eagerly with a fixed dimensionality.
- **Scoring** is the Qdrant match score; with `Cosine` distance that's cosine similarity (what `SemanticCache` expects).

## Testing

Unit tests use an in-memory fake client. Integration tests are guarded:

```bash
docker compose up -d qdrant
QDRANT_URL=http://localhost:6333 pnpm --filter @nodellmcache/qdrant test
```

## License

MIT
