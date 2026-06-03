/**
 * Using the Pinecone adapter directly (also usable as SemanticCache's vectorStore).
 * Requires an existing cosine index:
 *
 *   PINECONE_API_KEY=... PINECONE_INDEX=my-index \
 *     pnpm --filter @nodellmcache/examples pinecone
 */
import { PineconeAdapter } from '@nodellmcache/pinecone'

const store = new PineconeAdapter<{ source: string }>({
  apiKey: process.env.PINECONE_API_KEY,
  index: process.env.PINECONE_INDEX ?? 'demo-index',
  namespace: 'demo',
})

async function main(): Promise<void> {
  await store.upsert('doc-1', [1, 0, 0], { source: 'wiki' })
  await store.upsert('doc-2', [0, 1, 0], { source: 'blog' })

  // Pinecone is eventually consistent; give it a moment.
  await new Promise((r) => setTimeout(r, 3000))

  const matches = await store.query([0.9, 0.1, 0], 5)
  console.log('top match:', matches[0]?.id, matches[0]?.score.toFixed(3), matches[0]?.metadata)

  await store.delete('doc-1')
  await store.delete('doc-2')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
