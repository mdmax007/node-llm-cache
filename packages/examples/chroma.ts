/**
 * Using the Chroma adapter directly (also usable as SemanticCache's vectorStore).
 *
 *   docker run -p 8000:8000 chromadb/chroma
 *   CHROMA_URL=http://localhost:8000 pnpm --filter @nodellmcache/examples chroma
 */
import { ChromaAdapter } from '@nodellmcache/chroma'

const store = new ChromaAdapter<{ source: string }>({
  path: process.env.CHROMA_URL ?? 'http://localhost:8000',
  collection: 'demo_docs',
})

async function main(): Promise<void> {
  await store.upsert('doc-1', [1, 0, 0], { source: 'wiki' })
  await store.upsert('doc-2', [0, 1, 0], { source: 'blog' })

  const matches = await store.query([0.9, 0.1, 0], 5)
  console.log('top match:', matches[0]?.id, matches[0]?.score.toFixed(3), matches[0]?.metadata)

  const filtered = await store.query([1, 0, 0], 5, { source: 'blog' })
  console.log('filtered to blog:', filtered.map((m) => m.id))

  await store.delete('doc-1')
  await store.delete('doc-2')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
