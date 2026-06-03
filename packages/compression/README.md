# @nodellmcache/compression

Pure-JS compression engine for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Brotli, LZ4, and Gzip with automatic codec selection tuned for AI payloads (prompts, completions, embeddings, conversation history).

**No native bindings.** Brotli and Gzip use Node's built-in `zlib`; LZ4 uses the pure-JS [`lz4js`](https://www.npmjs.com/package/lz4js). Works on every platform without `node-gyp`.

## Install

```bash
npm install @nodellmcache/compression @nodellmcache/core
```

## Quick start

```ts
import { CompressionEngine } from '@nodellmcache/compression'

const engine = new CompressionEngine()

// Let the engine pick the codec from size + an optional data hint.
const result = await engine.auto(Buffer.from(JSON.stringify(bigPayload)), 'text')
console.log(result.algo)        // 'brotli'
console.log(result.ratio)       // e.g. 3.4
console.log(result.compressedSize)

// Decompress with the algorithm the engine reported.
const original = await engine.decompress(result.data, result.algo)
```

> **Always prefer `auto()`** over `compress()` with a fixed algorithm — it returns the chosen codec alongside the bytes, which is exactly what `decompress()` needs. Feature packages store `result.algo` in cache metadata.

## Codec selection (`auto`)

| Condition | Codec | Why |
|-----------|-------|-----|
| `< 1KB` | `none` | Overhead exceeds benefit |
| `1–50KB` | `lz4` | Fast, low CPU |
| `> 50KB` | `brotli` | Best ratio for large text |
| hint `embedding` | `lz4` (always) | Float arrays compress poorly; favour speed |
| hint `text` | `brotli` (always) | Text compresses very well |

`json` and `binary` hints fall back to the size-based rules.

## API

```ts
interface CompressionEngine {
  compress(data: Buffer, algo: CompressionAlgo): Promise<Buffer>
  decompress(data: Buffer, algo: CompressionAlgo): Promise<Buffer>
  auto(data: Buffer, hint?: DataHint): Promise<CompressedResult>
  stats(original: Buffer, compressed: Buffer): CompressionStats
  selectAlgo(size: number, hint?: DataHint): CompressionAlgo
}
```

- `compress`/`decompress` accept `none`, `gzip`, `brotli`, `lz4`. Passing `auto` throws (use `auto()`); `zstd` is not supported in v1 (Node ≥20 has no built-in zstd).
- Failures throw `CompressionError` from `@nodellmcache/core`.

## Benchmarks

Measured on Node 22 (single core). Throughput is `compress` ops/sec; ratio is `original ÷ compressed` (higher = smaller output).

| Payload | Codec | Ratio | Throughput |
|---------|-------|-------|-----------|
| LLM response (23 KB text) | brotli | **393×** | ~1.1k ops/s |
| | lz4 | 133× | ~24k ops/s |
| | gzip | 149× | ~19k ops/s |
| Embedding (6 KB float32) | brotli | 1.12× | ~170 ops/s |
| | lz4 | 1.00× | **~30k ops/s** |
| | gzip | 1.09× | ~16k ops/s |
| Conversation (18 KB JSON) | brotli | 48× | ~71 ops/s |
| | lz4 | 15× | ~24k ops/s |
| | gzip | 27× | ~20k ops/s |

**Takeaway:** brotli wins decisively on ratio for text but is 20–340× slower; lz4 is the throughput champion and the right default for embeddings (which barely compress anyway). `auto` encodes these trade-offs so callers don't have to. Re-run with `pnpm --filter @nodellmcache/compression bench`.

## License

MIT
