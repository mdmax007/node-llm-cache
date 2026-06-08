/**
 * Two-tier cache: L1 in-process memory + a slower "L2" (here a second
 * MemoryAdapter standing in for Redis). Watch a slow-tier hit get promoted into
 * L1. No external services needed.
 *
 *   pnpm --filter @nodellmcache/examples tiered
 */
import { TieredAdapter } from '@nodellmcache/tiered'
import { MemoryAdapter } from '@nodellmcache/memory'
import type { CacheEntry } from '@nodellmcache/core'

const l1 = new MemoryAdapter<string>()
const l2 = new MemoryAdapter<string>() // pretend this is Redis
const tiered = new TieredAdapter<string>({ tiers: [l1, l2] })

const entry = (key: string, value: string): CacheEntry<string> => ({
  key,
  value,
  createdAt: Date.now(),
  metadata: { compressed: false, originalSize: 0, cacheType: 'prompt' },
})

async function main(): Promise<void> {
  // Seed only the slow tier (as if L1 was cold / evicted).
  await l2.set('answer', entry('answer', '42'))
  console.log('in L1 before read?', await l1.has('answer')) // false

  const got = await tiered.get('answer')
  console.log('got:', got?.value)
  console.log('promoted into L1?', await l1.has('answer')) // true

  // Write-through hits both tiers.
  await tiered.set('greeting', entry('greeting', 'hello'))
  console.log('in L1:', await l1.has('greeting'), '| in L2:', await l2.has('greeting'))

  console.log('stats:', await tiered.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
