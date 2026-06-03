/**
 * Using the Weaviate adapter directly (also usable as SemanticCache's vectorStore).
 *
 *   docker run -p 8080:8080 -p 50051:50051 \
 *     -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true -e DEFAULT_VECTORIZER_MODULE=none \
 *     cr.weaviate.io/semitechnologies/weaviate:1.27.0
 *   WEAVIATE_HOST=localhost pnpm --filter @nodellmcache/examples weaviate
 */
import { WeaviateAdapter } from '@nodellmcache/weaviate'

const store = new WeaviateAdapter<{ source: string }>({
  host: process.env.WEAVIATE_HOST ?? 'localhost',
  port: process.env.WEAVIATE_PORT ? Number(process.env.WEAVIATE_PORT) : 8080,
  grpcPort: process.env.WEAVIATE_GRPC ? Number(process.env.WEAVIATE_GRPC) : 50051,
  collection: 'DemoDocs',
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
  await store.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
