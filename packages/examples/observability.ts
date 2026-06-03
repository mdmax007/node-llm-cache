/**
 * Observability: aggregate metrics across caches, then report.
 *
 * Run (no API key needed — uses a mock generator):
 *   pnpm --filter @nodellmcache/examples observability
 */
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

// Inject the shared collector so every cache reports into one place.
const cache = new PromptCache<string>({
  adapter: new MemoryAdapter<string>(),
  metrics: observability,
})

// Watch events live.
observability.on('cache.hit', (e) => console.log('  HIT ', e.cacheType))
observability.on('cache.miss', (e) => console.log('  MISS', e.cacheType))

// Stand in for a real LLM call.
const fakeModel = async (prompt: string): Promise<string> =>
  `Answer to: ${prompt} ${'.'.repeat(400)}`

async function ask(prompt: string): Promise<string> {
  return cache.getOrGenerate(prompt, () => fakeModel(prompt), {
    provider: 'openai',
    model: 'gpt-4o',
  })
}

async function main(): Promise<void> {
  const prompts = ['What is Redis?', 'What is Kubernetes?', 'What is Redis?']
  for (const p of prompts) await ask(p) // third is a cache hit
  await ask('What is Redis?') // another hit

  console.log('\nSnapshot:', await observability.snapshot())
  console.log()
  observability.printReport()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
