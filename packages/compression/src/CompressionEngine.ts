import { promisify } from 'node:util'
import {
  brotliCompress,
  brotliDecompress,
  gzip,
  gunzip,
  constants as zlibConstants,
} from 'node:zlib'
import { compress as lz4Compress, decompress as lz4Decompress } from 'lz4js'
import { CompressionError } from '@nodellmcache/core'
import type {
  CompressedResult,
  CompressionAlgo,
  CompressionEngine as ICompressionEngine,
  CompressionStats,
  DataHint,
} from '@nodellmcache/core'

const brotliCompressAsync = promisify(brotliCompress)
const brotliDecompressAsync = promisify(brotliDecompress)
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** Payloads at or below this size skip compression — overhead exceeds benefit. */
const NONE_THRESHOLD = 1024
/** Payloads at or below this size use lz4; larger text payloads use brotli. */
const LZ4_THRESHOLD = 50 * 1024

/**
 * Pure-JS compression engine. Uses Node's built-in `zlib` for Brotli and Gzip
 * and the pure-JS `lz4js` for LZ4 — no native bindings, so it ships everywhere.
 *
 * Prefer {@link auto}, which selects a codec from payload size and an optional
 * {@link DataHint}, over calling {@link compress} with a fixed algorithm.
 */
export class CompressionEngine implements ICompressionEngine {
  /**
   * Chooses a codec from payload size and an optional data hint.
   *
   * - `embedding` hint → always `lz4` (float arrays)
   * - `text` hint → always `brotli` (text compresses well)
   * - otherwise by size: `< 1KB` → `none`, `1–50KB` → `lz4`, `> 50KB` → `brotli`
   */
  selectAlgo(size: number, hint?: DataHint): CompressionAlgo {
    if (hint === 'embedding') return 'lz4'
    if (hint === 'text') return 'brotli'
    if (size < NONE_THRESHOLD) return 'none'
    if (size <= LZ4_THRESHOLD) return 'lz4'
    return 'brotli'
  }

  /**
   * Compresses `data` with a concrete algorithm. Passing `auto` throws —
   * use {@link auto} for heuristic selection so the chosen algorithm is
   * returned alongside the bytes (decompression needs to know it).
   */
  async compress(data: Buffer, algo: CompressionAlgo): Promise<Buffer> {
    switch (algo) {
      case 'none':
        return Buffer.from(data)
      case 'gzip':
        return gzipAsync(data)
      case 'brotli':
        return brotliCompressAsync(data, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length,
          },
        })
      case 'lz4':
        try {
          return Buffer.from(lz4Compress(data))
        } catch (cause) {
          throw new CompressionError('LZ4 compression failed', { cause })
        }
      case 'zstd':
        throw new CompressionError(
          "Compression algorithm 'zstd' is not supported in v1 (Node >=20 has no built-in zstd)",
        )
      case 'auto':
        throw new CompressionError(
          "compress() requires a concrete algorithm; use auto() for heuristic selection",
        )
      default: {
        // Exhaustiveness guard — surfaces an unhandled algo as a typed error.
        const exhaustive: never = algo
        throw new CompressionError(`Unknown compression algorithm: ${String(exhaustive)}`)
      }
    }
  }

  /**
   * Reverses {@link compress} for the same algorithm. Passing `auto` or `zstd`
   * throws, mirroring {@link compress}.
   */
  async decompress(data: Buffer, algo: CompressionAlgo): Promise<Buffer> {
    switch (algo) {
      case 'none':
        return Buffer.from(data)
      case 'gzip':
        return gunzipAsync(data)
      case 'brotli':
        return brotliDecompressAsync(data)
      case 'lz4':
        try {
          return Buffer.from(lz4Decompress(data))
        } catch (cause) {
          throw new CompressionError('LZ4 decompression failed', { cause })
        }
      case 'zstd':
        throw new CompressionError(
          "Compression algorithm 'zstd' is not supported in v1 (Node >=20 has no built-in zstd)",
        )
      case 'auto':
        throw new CompressionError(
          "decompress() requires the concrete algorithm used to compress the data",
        )
      default: {
        const exhaustive: never = algo
        throw new CompressionError(`Unknown compression algorithm: ${String(exhaustive)}`)
      }
    }
  }

  /**
   * Compresses using the algorithm chosen by {@link selectAlgo}, returning the
   * bytes, the chosen algorithm, and timing/size stats.
   */
  async auto(data: Buffer, hint?: DataHint): Promise<CompressedResult> {
    const algo = this.selectAlgo(data.length, hint)
    const start = performance.now()
    const compressed = await this.compress(data, algo)
    const durationMs = performance.now() - start
    const { ratio } = this.stats(data, compressed)
    return {
      data: compressed,
      algo,
      originalSize: data.length,
      compressedSize: compressed.length,
      ratio,
      durationMs,
    }
  }

  /**
   * Computes compression statistics. For an empty original, reports a neutral
   * 1× ratio with zero savings rather than dividing by zero.
   */
  stats(original: Buffer, compressed: Buffer): CompressionStats {
    const originalSize = original.length
    const compressedSize = compressed.length
    if (originalSize === 0) {
      return { originalSize, compressedSize, ratio: 1, savedBytes: 0, savedPercent: 0 }
    }
    const savedBytes = originalSize - compressedSize
    return {
      originalSize,
      compressedSize,
      ratio: compressedSize === 0 ? Infinity : originalSize / compressedSize,
      savedBytes,
      savedPercent: (savedBytes / originalSize) * 100,
    }
  }
}
