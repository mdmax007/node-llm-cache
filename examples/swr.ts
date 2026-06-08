/**
 * Stale-while-revalidate: serve a slightly stale answer instantly while a fresh
 * one is fetched in the background. Built into every cache manager via
 * getOrRevalidate. No external services needed.
 *
 *   pnpm --filter @nodellmcache/examples swr
 */
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new PromptCache<string>({ adapter: new MemoryAdapter<string>() })

let version = 0
const generate = async (): Promise<string> => {
  await new Promise((r) => setTimeout(r, 50)) // pretend the model is slow
  return `answer v${++version}`
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  // Fresh for 5s, stale-but-servable for the rest of a 1h TTL.
  const opts = { ttl: 60 * 60 * 1000, staleTtl: 300 }

  console.log('1st call (miss, generates):', await cache.getOrRevalidate('q', generate, opts))
  console.log('2nd call (fresh hit):      ', await cache.getOrRevalidate('q', generate, opts))

  await wait(400) // now past staleTtl -> stale

  // Returns the stale value immediately and kicks off a background refresh.
  console.log('3rd call (stale, instant): ', await cache.getOrRevalidate('q', generate, opts))

  await wait(150) // let the background refresh finish

  console.log('4th call (refreshed value):', await cache.getOrRevalidate('q', generate, opts))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
