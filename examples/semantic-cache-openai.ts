/**
 * Semantic caching with OpenAI: a paraphrased question hits the cached answer.
 *
 * Run with a real key:
 *   OPENAI_API_KEY=sk-... pnpm --filter @nodellmcache/examples semantic-cache:openai
 */
import OpenAI from 'openai'
import { SemanticCache } from '@nodellmcache/semantic-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()

const cache = new SemanticCache<string>({
  similarityThreshold: 0.92,
  adapter: new MemoryAdapter<string>(),
  embeddingFn: (text) =>
    openai.embeddings
      .create({ model: 'text-embedding-3-small', input: text })
      .then((r) => r.data[0]!.embedding),
})

function answer(prompt: string) {
  return cache.getOrGenerate(
    prompt,
    async () => {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      })
      return res.choices[0]?.message.content ?? ''
    },
    { provider: 'openai', model: 'gpt-4o' },
  )
}

async function main(): Promise<void> {
  const first = await answer('What is Kubernetes?')
  console.log('first  fromCache:', first.fromCache)

  // Paraphrased — should hit semantically.
  const second = await answer('Explain Kubernetes')
  console.log('second fromCache:', second.fromCache, '| similarity:', second.similarity)
  console.log('matched query   :', second.matchedQuery)

  console.log(await cache.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
