/**
 * Prompt caching with OpenAI.
 *
 * Run with a real key:
 *   OPENAI_API_KEY=sk-... pnpm --filter @nodellmcache/examples prompt-cache:openai
 *
 * The first call hits the API; the second is served from cache for free.
 */
import OpenAI from 'openai'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()

const cache = new PromptCache<string>({
  adapter: new MemoryAdapter<string>({ maxSize: 100 * 1024 * 1024 }),
  defaultTTL: 60 * 60 * 1000, // 1 hour
})

function ask(prompt: string): Promise<string> {
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
  const prompt = 'Explain Redis in one paragraph.'

  console.time('first (API)')
  console.log(await ask(prompt))
  console.timeEnd('first (API)')

  console.time('second (cache)')
  await ask(prompt)
  console.timeEnd('second (cache)')

  console.log(await cache.stats())
  // e.g. { hits: 1, misses: 1, hitRate: 0.5, tokensSaved: 312, estimatedSavingsUSD: 0.0031 }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
