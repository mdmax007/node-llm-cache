# @nodellmcache/milvus

[Milvus](https://milvus.io) vector-store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Implements `VectorStoreAdapter`, so it plugs into `@nodellmcache/semantic-cache` or works standalone.

## Install

`@zilliz/milvus2-sdk-node` is an **optional peer dependency** (lazily loaded), so install it alongside:

```bash
npm install @nodellmcache/milvus @nodellmcache/core @zilliz/milvus2-sdk-node
```

Run Milvus (standalone) via its [docker-compose](https://milvus.io/docs/install_standalone-docker-compose.md).

## Quick start

```ts
import { MilvusAdapter } from '@nodellmcache/milvus'

const store = new MilvusAdapter<{ source: string }>({
  address: 'localhost:19530',
  collection: 'docs', // created on first use
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
| `collection` | — (required) | Collection name (created on demand) |
| `address` | `localhost:19530` | Endpoint (or Zilliz Cloud URI) |
| `token` / `username` / `password` / `ssl` | — | Auth |
| `vectorSize` | inferred | Dimensionality |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `store` | constructed | Inject a `MilvusStore` (e.g. to avoid the optional SDK) |

## Notes

- The collection is created on demand: `id` (VarChar PK), `vector` (FloatVector), `metadata` (JSON), with an `AUTOINDEX` using the **cosine** metric so `score` is cosine similarity.
- **String ids** are native. Metadata filters are flat equality over the JSON field (`metadata["key"] == value`, AND-combined).
- The SDK is loaded lazily; if it isn't installed, construction throws a clear error (or inject your own `MilvusStore`).

## Testing

Unit tests use an in-memory fake store. Integration tests require a running Milvus and the SDK installed:

```bash
MILVUS_ADDRESS=localhost:19530 pnpm --filter @nodellmcache/milvus test
```

## License

MIT
