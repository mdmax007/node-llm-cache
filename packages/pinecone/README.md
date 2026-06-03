# @nodellmcache/pinecone

[Pinecone](https://www.pinecone.io) vector-store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Implements `VectorStoreAdapter`, so it plugs into `@nodellmcache/semantic-cache` or works standalone.

## Install

```bash
npm install @nodellmcache/pinecone @nodellmcache/core @pinecone-database/pinecone
```

## Quick start

Create an index in the Pinecone console (or API) with the **cosine** metric and your embedding dimension, then:

```ts
import { PineconeAdapter } from '@nodellmcache/pinecone'

const store = new PineconeAdapter<{ source: string }>({
  apiKey: process.env.PINECONE_API_KEY,
  index: 'my-index',
  namespace: 'docs', // optional
})

await store.upsert('doc-1', embedding, { source: 'wiki' })
const matches = await store.query(queryEmbedding, 5, { source: 'wiki' })
// → [{ id: 'doc-1', score: 0.94, metadata: { source: 'wiki' } }]
await store.delete('doc-1')
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `index` | — (required) | Existing index name |
| `apiKey` | `PINECONE_API_KEY` env | API key |
| `namespace` | — | Optional namespace within the index |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `client` | constructed | Inject an existing Pinecone index handle (or compatible) |

## Notes

- The index must already exist (index creation is provisioned out-of-band). Use the **cosine** metric so `score` is cosine similarity (what `SemanticCache` expects).
- **String ids** are native. Metadata filters use Pinecone's `$eq` form (keys AND-ed). Pinecone metadata values must be string/number/boolean/string[].
- Pinecone is eventually consistent — a freshly upserted vector may take a moment to appear in queries.

## Testing

Unit tests use an in-memory fake. Integration tests require credentials and an existing index:

```bash
PINECONE_API_KEY=... PINECONE_INDEX=my-index pnpm --filter @nodellmcache/pinecone test
```

## License

MIT
