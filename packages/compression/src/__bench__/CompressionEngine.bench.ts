import { bench, describe } from 'vitest'
import { CompressionEngine } from '../CompressionEngine.js'

const engine = new CompressionEngine()

/** A realistic LLM completion: prose with structure. */
const llmResponse = Buffer.from(
  'In distributed systems, caching reduces latency and load. '.repeat(400),
)

/** An OpenAI-style embedding: 1536 float32s. */
const embedding = Buffer.from(Float32Array.from({ length: 1536 }, (_, i) => Math.sin(i)).buffer)

/** A multi-turn conversation history as JSON. */
const conversation = Buffer.from(
  JSON.stringify(
    Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `Message ${i}: discussing caching strategies and trade-offs.`,
    })),
  ),
)

const cases = [
  { name: 'llm-response', data: llmResponse },
  { name: 'embedding', data: embedding },
  { name: 'conversation', data: conversation },
] as const

for (const { name, data } of cases) {
  describe(`${name} (${data.length} bytes)`, () => {
    bench('brotli', async () => {
      await engine.compress(data, 'brotli')
    })
    bench('lz4', async () => {
      await engine.compress(data, 'lz4')
    })
    bench('gzip', async () => {
      await engine.compress(data, 'gzip')
    })
    bench('auto', async () => {
      await engine.auto(data)
    })
  })
}
