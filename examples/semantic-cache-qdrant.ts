/**
 * Semantic caching backed by Qdrant — similarity search scales beyond the
 * in-memory index. Uses a deterministic mock embedder so it runs with just a
 * local Qdrant (no API key):
 *
 *   docker compose up -d qdrant
 *   QDRANT_URL=http://localhost:6333 \
 *     pnpm --filter @nodellmcache/examples semantic-cache-qdrant
 *
 * Swap `mockEmbed` for a real provider embedding call in production.
 */
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { QdrantAdapter } from '@nodellmcache/qdrant'
import { MemoryAdapter } from '@nodellmcache/memory'

// Tiny deterministic embedder: hash words into a fixed-size vector.
function mockEmbed(text: string): Promise<number[]> {
  const dim = 16
  const v = new Array<number>(dim).fill(0)
  for (const word of text.toLowerCase().split(/\s+/)) {
    let h = 0
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % dim
    v[h] = (v[h] ?? 0) + 1
  }
  return Promise.resolve(v)
}

const cache = new SemanticCache<string>({
  similarityThreshold: 0.7,
  adapter: new MemoryAdapter<string>(), // stores responses
  embeddingFn: mockEmbed,
  vectorStore: new QdrantAdapter<{ query: string }>({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    collection: 'demo_semantic',
  }),
})

async function main(): Promise<void> {
  let calls = 0
  const generate = async () => {
    calls++
    return 'Kubernetes is a container orchestration platform.'
  }

  const first = await cache.getOrGenerate('what is kubernetes', generate)
  console.log('first  fromCache:', first.fromCache)

  const second = await cache.getOrGenerate('what is kubernetes really', generate)
  console.log('second fromCache:', second.fromCache, '| similarity:', second.similarity.toFixed(3))

  console.log('generator calls:', calls)
  console.log(await cache.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
