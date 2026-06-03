/**
 * @nodellmcache/compression: automatic codec selection + round-trips. Pure JS,
 * no external services.
 *
 *   pnpm --filter @nodellmcache/examples compression
 */
import { CompressionEngine } from '@nodellmcache/compression'

const engine = new CompressionEngine()

async function main(): Promise<void> {
  const text = Buffer.from('Caching reduces latency and cost. '.repeat(400))

  // auto() picks a codec from size + an optional hint, and reports stats.
  const result = await engine.auto(text, 'text')
  console.log('algo:', result.algo, '| ratio:', result.ratio.toFixed(1), '| bytes:', result.originalSize, '->', result.compressedSize)

  // Decompress with the algorithm auto() chose.
  const restored = await engine.decompress(result.data, result.algo)
  console.log('round-trips:', restored.toString() === text.toString())

  // Embeddings favour lz4; small payloads skip compression entirely.
  console.log('embedding hint ->', engine.selectAlgo(100_000, 'embedding'))
  console.log('tiny payload   ->', engine.selectAlgo(200))

  const lz4 = await engine.compress(text, 'lz4')
  console.log('lz4 stats:', engine.stats(text, lz4))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
