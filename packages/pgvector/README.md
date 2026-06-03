# @nodellmcache/pgvector

Postgres + [pgvector](https://github.com/pgvector/pgvector) store adapter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Implements `VectorStoreAdapter`, so it plugs into `@nodellmcache/semantic-cache` — "you already have Postgres" is reason enough to use it.

## Install

```bash
npm install @nodellmcache/pgvector @nodellmcache/core pg
```

Requires the `vector` extension (the adapter runs `CREATE EXTENSION IF NOT EXISTS vector`):

```bash
docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 pgvector/pgvector:pg16
```

## Quick start

```ts
import { PgVectorAdapter } from '@nodellmcache/pgvector'

const store = new PgVectorAdapter<{ source: string }>({
  connectionString: 'postgres://postgres:pw@localhost:5432/postgres',
  table: 'embeddings', // created on first use
})

await store.upsert('doc-1', embedding, { source: 'wiki' })
const matches = await store.query(queryEmbedding, 5, { source: 'wiki' })
// → [{ id: 'doc-1', score: 0.94, metadata: { source: 'wiki' } }]
await store.delete('doc-1')
await store.disconnect()
```

## Schema & queries

The adapter manages a table `(id text primary key, embedding vector(dim), metadata jsonb)`:

- **upsert** → `INSERT ... ON CONFLICT (id) DO UPDATE`.
- **query** → ordered by cosine distance `embedding <=> $1`, returning `score = 1 - distance` (cosine similarity). Metadata filters use jsonb containment (`metadata @> $filter`).
- Dimension is taken from `vectorSize` or inferred from the first upserted vector.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `connectionString` / `host`+`port`+`user`+`password`+`database` | `localhost:5432` | Connection (or pass `client`) |
| `table` | `nodellmcache_vectors` | Table name (validated as a safe identifier) |
| `vectorSize` | inferred | Dimensionality |
| `ssl` / `max` | — | Passed to the `pg` pool |
| `maxRetries` | `3` | Attempts per op on transient failure |
| `client` | constructed | Inject an existing `pg` pool/client (or compatible) |

## Testing

Unit tests use an in-memory fake. Integration tests are guarded:

```bash
docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 pgvector/pgvector:pg16
PGVECTOR_URL=postgres://postgres:pw@localhost:5432/postgres pnpm --filter @nodellmcache/pgvector test
```

## License

MIT
