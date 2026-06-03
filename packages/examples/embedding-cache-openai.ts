/**
 * Embedding caching with OpenAI, including batch dedup.
 *
 * Run with a real key:
 *   OPENAI_API_KEY=sk-... pnpm --filter @nodellmcache/examples embedding-cache:openai
 */
import OpenAI from 'openai'
import { EmbeddingCache } from '@nodellmcache/embedding-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()
const MODEL = 'text-embedding-3-small'

const cache = new EmbeddingCache({
  // 'embedding' cache type triggers the lz4 hint for a compact footprint.
  adapter: new MemoryAdapter({ compression: 'auto' }),
})

async function embedBatch(texts: string[]): Promise<number[][]> {
  return cache.getBatch(
    texts,
    async (uncached) => {
      const res = await openai.embeddings.create({ model: MODEL, input: uncached })
      return res.data.map((d) => d.embedding)
    },
    { provider: 'openai', model: MODEL },
  )
}

async function main(): Promise<void> {
  // Note the duplicates — the API is called once for the unique set.
  const texts = ['dog', 'cat', 'dog', 'bird', 'cat']

  const first = await embedBatch(texts)
  console.log(`got ${first.length} embeddings (dim ${first[0]?.length})`)

  // Second pass is fully served from cache.
  await embedBatch(texts)

  console.log(await cache.stats())
  // e.g. { embeddingsReused: 5, apiCallsAvoided: 7, hitRate: 0.5, ... }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
