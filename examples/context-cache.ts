/**
 * Caching assembled context windows, with version-aware busting.
 *
 * Runs as-is (no credentials needed):
 *   pnpm --filter @nodellmcache/examples context-cache
 */
import { ContextCache } from '@nodellmcache/context-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new ContextCache<string>({ adapter: new MemoryAdapter<string>() })

let assemblies = 0
// Stand-in for the (expensive) context assembly: select, trim, format docs.
async function assemble(query: string, docs: { id: string; version: number }[]): Promise<string> {
  assemblies++
  return `# Context for "${query}"\n` + docs.map((d) => `- ${d.id} (v${d.version})`).join('\n')
}

async function getContext(query: string, docs: { id: string; version: number }[]): Promise<string> {
  return cache.getOrAssemble(query, docs, () => assemble(query, docs))
}

async function main(): Promise<void> {
  const docs = [
    { id: 'doc-1', version: 1 },
    { id: 'doc-2', version: 1 },
  ]

  await getContext('explain TLS', docs) // miss → assembled
  await getContext('explain TLS', [docs[1]!, docs[0]!]) // hit (order-independent)
  console.log('assemblies so far:', assemblies) // 1

  // doc-2 was re-indexed at v2 → context must be rebuilt.
  await getContext('explain TLS', [{ id: 'doc-1', version: 1 }, { id: 'doc-2', version: 2 }])
  console.log('assemblies total:', assemblies) // 2

  console.log(await cache.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
