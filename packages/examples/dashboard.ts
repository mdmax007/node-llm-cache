/**
 * Live dashboard demo: starts the dashboard and drives mock cache traffic so the
 * UI fills with data. Open the printed URL, then Ctrl+C to stop.
 *
 *   pnpm --filter @nodellmcache/examples dashboard
 */
import { startDashboard } from '@nodellmcache/dashboard'
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new PromptCache<string>({
  adapter: new MemoryAdapter<string>(),
  metrics: observability,
})

const prompts = ['what is redis', 'explain kubernetes', 'what is redis', 'define rag', 'what is redis']

async function main(): Promise<void> {
  const dash = await startDashboard()
  console.log(`dashboard: ${dash.url}`)
  observability.recordCompression({ originalSize: 8000, compressedSize: 1800 })

  // Generate a steady stream of hits and misses.
  setInterval(() => {
    const prompt = prompts[Math.floor(Math.random() * prompts.length)]!
    void cache.getOrGenerate(prompt, async () => 'answer ' + 'x'.repeat(300), {
      provider: 'openai',
      model: 'gpt-4o',
    })
  }, 250)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
