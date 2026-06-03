# @nodellmcache/weaviate

[Weaviate](https://weaviate.io) vector-store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache), built on the v3 `weaviate-client`. Implements `VectorStoreAdapter`, so it plugs into `@nodellmcache/semantic-cache` or works standalone.

## Install

```bash
npm install @nodellmcache/weaviate @nodellmcache/core weaviate-client
docker run -p 8080:8080 -p 50051:50051 \
  -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true -e DEFAULT_VECTORIZER_MODULE=none \
  cr.weaviate.io/semitechnologies/weaviate:1.27.0
```

## Quick start

```ts
import { WeaviateAdapter } from '@nodellmcache/weaviate'

const store = new WeaviateAdapter<{ source: string }>({
  host: 'localhost',
  port: 8080,
  grpcPort: 50051,
  collection: 'Docs', // created on first use, self-provided vectors
})

await store.upsert('doc-1', embedding, { source: 'wiki' })
const matches = await store.query(queryEmbedding, 5, { source: 'wiki' })
// → [{ id: 'doc-1', score: 0.94, metadata: { source: 'wiki' } }]
await store.delete('doc-1')
await store.disconnect()
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `collection` | — (required) | Collection (class) name; created on demand |
| `host` / `port` / `grpcPort` | `localhost` / `8080` / `50051` | Local connection (or inject a `store`) |
| `idKey` | `'__id'` | Property that round-trips the original string id |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `store` | constructed | Inject a `WeaviateStore` implementation (e.g. for Weaviate Cloud) |

## Notes

- **Arbitrary string ids** are mapped to deterministic v4-shaped UUIDs (Weaviate requires UUID object ids); the original is stored in `idKey` and restored on query.
- **upsert** uses replace semantics (delete-then-insert) so re-upserting an id overwrites it.
- **Scoring** is `1 - distance` (cosine similarity for the default distance).
- Cloud/custom connections: build your own `WeaviateStore` and pass it as `store`.

## Testing

```bash
# with the docker command above:
WEAVIATE_HOST=localhost WEAVIATE_PORT=8080 WEAVIATE_GRPC=50051 \
  pnpm --filter @nodellmcache/weaviate test
```

## License

MIT
