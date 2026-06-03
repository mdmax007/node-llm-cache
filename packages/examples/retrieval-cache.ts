/**
 * Caching RAG retrieval + reranker results, with document-aware invalidation.
 *
 * Retriever-agnostic — swap `searchVectorDb` for a real Qdrant/pgvector/Pinecone
 * query. Runs as-is with a mock retriever (no credentials needed):
 *   pnpm --filter @nodellmcache/examples retrieval-cache
 */
import { RetrievalCache, type RetrievedDocument } from '@nodellmcache/retrieval-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const cache = new RetrievalCache({
  adapter: new MemoryAdapter<RetrievedDocument[]>(),
  defaultTTL: 5 * 60 * 1000,
})

let dbCalls = 0
// Stand-in for a vector DB query (e.g. qdrantClient.search(...)).
async function searchVectorDb(_query: string): Promise<RetrievedDocument[]> {
  dbCalls++
  return [
    { id: 'doc-1', score: 0.91, content: 'Caching reduces latency.' },
    { id: 'doc-2', score: 0.88, content: 'TTL controls freshness.' },
  ]
}

async function retrieve(query: string): Promise<RetrievedDocument[]> {
  return cache.getOrGenerate(query, () => searchVectorDb(query), { provider: 'openai' })
}

async function main(): Promise<void> {
  await retrieve('how does caching help?') // miss → DB
  await retrieve('how does caching help?') // hit
  console.log('vector DB calls so far:', dbCalls) // 1

  // A document changed → evict just the affected entries.
  const removed = await cache.invalidateByDocument('doc-1')
  console.log('entries invalidated by doc-1 update:', removed)

  await retrieve('how does caching help?') // miss again → DB
  console.log('vector DB calls total:', dbCalls) // 2

  console.log(await cache.stats())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
