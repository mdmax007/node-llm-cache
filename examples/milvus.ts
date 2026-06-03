/**
 * Using the Milvus adapter directly (also usable as SemanticCache's vectorStore).
 * Requires a running Milvus and @zilliz/milvus2-sdk-node installed:
 *
 *   MILVUS_ADDRESS=localhost:19530 pnpm --filter @nodellmcache/examples milvus
 */
import { MilvusAdapter } from '@nodellmcache/milvus'

const store = new MilvusAdapter<{ source: string }>({
  address: process.env.MILVUS_ADDRESS ?? 'localhost:19530',
  collection: 'demo_docs',
})

async function main(): Promise<void> {
  await store.upsert('doc-1', [1, 0, 0], { source: 'wiki' })
  await store.upsert('doc-2', [0, 1, 0], { source: 'blog' })
  await new Promise((r) => setTimeout(r, 1000)) // allow indexing

  const matches = await store.query([0.9, 0.1, 0], 5)
  console.log('top match:', matches[0]?.id, matches[0]?.score.toFixed(3), matches[0]?.metadata)

  const filtered = await store.query([1, 0, 0], 5, { source: 'blog' })
  console.log('filtered to blog:', filtered.map((m) => m.id))

  await store.delete('doc-1')
  await store.delete('doc-2')
  await store.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
