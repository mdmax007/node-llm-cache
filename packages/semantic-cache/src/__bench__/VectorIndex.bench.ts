import { bench, describe } from 'vitest'
import { InMemoryVectorIndex } from '../VectorIndex.js'

const DIM = 1536 // OpenAI text-embedding-3-small

function randomVector(): number[] {
  return Array.from({ length: DIM }, () => Math.random())
}

// Brute-force search cost grows linearly with index size. These benchmarks
// validate that the in-memory index is comfortable up to ~10k entries.
for (const size of [100, 1_000, 10_000]) {
  describe(`InMemoryVectorIndex search (${size} entries × ${DIM} dims)`, () => {
    const index = new InMemoryVectorIndex()
    for (let i = 0; i < size; i++) void index.add(`k${i}`, randomVector(), `q${i}`)
    const query = randomVector()

    bench('search', async () => {
      await index.search(query)
    })
  })
}
