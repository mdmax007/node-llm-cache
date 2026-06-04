# NodeLLMCache examples

Runnable examples, one per package. Private (not published); every file uses the public `@nodellmcache/*` package names so it mirrors real usage.

## Running

From the repo root (build the packages first with `pnpm turbo build`):

```bash
pnpm --filter @nodellmcache/examples <script>
```

The examples that use mock data run with no credentials or services — start there:

| Script | Needs |
|--------|-------|
| `core` | — (KeyBuilder, TTL, a custom adapter) |
| `compression` | — (auto codec selection, round-trips) |
| `memory` | — (LRU eviction, TTL, compression) |
| `observability` | — (mock generator) |
| `retrieval-cache` | — (mock retriever) |
| `context-cache` | — (mock assembler) |
| `agent-memory-single` | — |
| `agent-memory-multi-agent` | — |
| `dashboard` | — (opens http://127.0.0.1:4242) |
| `prompt-cache:openai` | `OPENAI_API_KEY` |
| `prompt-cache:anthropic` | `ANTHROPIC_API_KEY` |
| `embedding-cache:openai` | `OPENAI_API_KEY` |
| `semantic-cache:openai` | `OPENAI_API_KEY` |
| `observability` | — (mock generator) |
| `retrieval-cache` | — (mock retriever) |
| `context-cache` | — (mock assembler) |
| `agent-memory-single` | — |
| `agent-memory-multi-agent` | — |
| `semantic-cache-qdrant` | local Qdrant (`QDRANT_URL`) |
| `pgvector` | local Postgres+pgvector (`PGVECTOR_URL`) |
| `chroma` | local Chroma (`CHROMA_URL`) |
| `weaviate` | local Weaviate (`WEAVIATE_HOST`) |
| `pinecone` | `PINECONE_API_KEY` + `PINECONE_INDEX` |
| `milvus` | local Milvus (`MILVUS_ADDRESS`) + `@zilliz/milvus2-sdk-node` |

Start local services with the repo's `docker-compose.yml`:

```bash
docker compose up -d redis qdrant pgvector chroma weaviate
```

The examples that use only mock generators/retrievers run with no credentials or services.
