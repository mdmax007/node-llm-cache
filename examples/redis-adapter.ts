/**
 * Prompt caching backed by Redis — a shared, persistent cache across processes.
 *
 * Run with a Redis instance (e.g. `docker compose up -d redis`):
 *   REDIS_URL=redis://localhost:6379 OPENAI_API_KEY=sk-... \
 *     pnpm --filter @nodellmcache/examples redis-adapter
 */
import OpenAI from 'openai'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { RedisAdapter } from '@nodellmcache/redis'

const openai = new OpenAI()

const adapter = new RedisAdapter<string>({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  namespace: 'demo:prompt:',
  compression: 'auto', // large responses compress before hitting the wire
})

const cache = new PromptCache<string>({ adapter, defaultTTL: 24 * 60 * 60 * 1000 })

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
  const prompt = 'Summarize the CAP theorem in two sentences.'
  console.log('ping:', await adapter.ping())

  await ask(prompt) // miss → API, stored in Redis
  await ask(prompt) // hit → from Redis (also works from another process)

  console.log(await cache.stats())
  console.log('redis stats:', await adapter.stats())

  await adapter.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
