/**
 * Multi-agent memory: each agent's memory is isolated, sharing one backend.
 *
 * Runs as-is (no credentials needed):
 *   pnpm --filter @nodellmcache/examples agent-memory-multi-agent
 */
import { AgentMemory } from '@nodellmcache/agent-memory'
import { MemoryAdapter } from '@nodellmcache/memory'

// One shared backing store; memories are namespaced per agentId.
const memory = new AgentMemory({ adapter: new MemoryAdapter() })

async function main(): Promise<void> {
  await memory.store('researcher', { type: 'semantic', content: 'cites sources for every claim', importance: 0.9 })
  await memory.store('researcher', { type: 'episodic', content: 'reviewed the caching paper', importance: 0.5 })

  await memory.store('coder', { type: 'semantic', content: 'prefers TypeScript and small functions', importance: 0.9 })
  await memory.store('coder', { type: 'procedural', content: 'run tests before every commit', importance: 0.8 })

  // Each agent only sees its own memories.
  const researcherMem = await memory.recall('researcher', 'sources')
  const coderMem = await memory.recall('coder', 'typescript')

  console.log('researcher recall:', researcherMem.map((m) => m.content))
  console.log('coder recall     :', coderMem.map((m) => m.content))

  // Cross-check isolation: the coder has no memory of the caching paper.
  console.log('coder knows the paper?', (await memory.recall('coder', 'caching paper', { minScore: 0.5 })).length > 0)

  console.log('\n--- researcher ---\n' + (await memory.summarize('researcher')))
  console.log('\n--- coder ---\n' + (await memory.summarize('coder')))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
