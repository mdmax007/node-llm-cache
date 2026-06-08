/**
 * Bridge cache metrics to OpenTelemetry. Normally your app configures an OTel
 * SDK + exporter; here we inject a tiny logging meter so you can see exactly
 * what gets recorded. No external services needed.
 *
 *   pnpm --filter @nodellmcache/examples otel
 */
import { attachOtel, type MeterLike } from '@nodellmcache/otel'
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

// A stand-in Meter that just logs — in production this is your OTel Meter.
const loggingMeter: MeterLike = {
  createCounter(name) {
    return { add: (value, attrs) => console.log(`counter ${name} +${value}`, attrs ?? {}) }
  },
  createHistogram(name) {
    return { record: (value, attrs) => console.log(`histogram ${name} = ${value}`, attrs ?? {}) }
  },
}

const handle = attachOtel(observability, { meter: loggingMeter })

const cache = new PromptCache<string>({ adapter: new MemoryAdapter<string>(), metrics: observability })

async function main(): Promise<void> {
  const gen = async () => 'answer ' + 'x'.repeat(120)
  await cache.getOrGenerate('what is redis', gen, { provider: 'openai', model: 'gpt-4o' }) // miss + set
  await cache.getOrGenerate('what is redis', gen, { provider: 'openai', model: 'gpt-4o' }) // hit + tokens saved
  handle.detach()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
