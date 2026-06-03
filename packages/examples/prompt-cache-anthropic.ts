/**
 * Prompt caching with Anthropic (Claude).
 *
 * Run with a real key:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @nodellmcache/examples prompt-cache:anthropic
 *
 * The first call hits the API; the second is served from cache for free.
 */
import Anthropic from '@anthropic-ai/sdk'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const client = new Anthropic()

const cache = new PromptCache<string>({
  adapter: new MemoryAdapter<string>(),
  // Claude responses are stable; cache them for a day (also the default).
  ttlByProvider: { anthropic: 24 * 60 * 60 * 1000 },
})

function ask(prompt: string): Promise<string> {
  return cache.getOrGenerate(
    prompt,
    async () => {
      const msg = await client.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })
      const block = msg.content[0]
      return block && block.type === 'text' ? block.text : ''
    },
    { provider: 'anthropic', model: 'claude-3-5-sonnet' },
  )
}

async function main(): Promise<void> {
  const prompt = 'Explain vector databases in one paragraph.'

  console.time('first (API)')
  console.log(await ask(prompt))
  console.timeEnd('first (API)')

  console.time('second (cache)')
  await ask(prompt)
  console.timeEnd('second (cache)')

  console.log(await cache.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
