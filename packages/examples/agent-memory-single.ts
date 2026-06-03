/**
 * Single-agent memory: store facts, recall relevant ones, use working memory.
 *
 * Runs as-is (no credentials needed):
 *   pnpm --filter @nodellmcache/examples agent-memory-single
 */
import { AgentMemory } from '@nodellmcache/agent-memory'
import { MemoryAdapter } from '@nodellmcache/memory'

const memory = new AgentMemory({ adapter: new MemoryAdapter() })
const agentId = 'assistant-001'

async function main(): Promise<void> {
  await memory.store(agentId, {
    type: 'semantic',
    content: 'User prefers concise answers without bullet points',
    importance: 0.9,
  })
  await memory.store(agentId, {
    type: 'episodic',
    content: 'User asked about Kubernetes networking',
    importance: 0.5,
  })
  await memory.store(agentId, {
    type: 'procedural',
    content: 'To deploy, run pnpm build then pnpm release',
    importance: 0.7,
  })

  const relevant = await memory.recall(agentId, 'kubernetes')
  console.log('recall "kubernetes":', relevant.map((m) => m.content))

  // Working memory for the current task.
  await memory.storeWorking(agentId, { task: 'summarize docs', step: 2 })
  console.log('working:', await memory.getWorkingMemory(agentId))
  await memory.clearWorkingMemory(agentId)

  console.log('\n' + (await memory.summarize(agentId)))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
