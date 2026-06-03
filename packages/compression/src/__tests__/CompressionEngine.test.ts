import { describe, it, expect } from 'vitest'
import { CompressionEngine } from '../CompressionEngine.js'
import { CompressionError } from '@nodellmcache/core'
import type { CompressionAlgo } from '@nodellmcache/core'

const engine = new CompressionEngine()

describe('CompressionEngine', () => {
  describe('round-trips', () => {
    const concrete: CompressionAlgo[] = ['none', 'gzip', 'brotli', 'lz4']

    it.each(concrete)('compresses and decompresses correctly with %s', async (algo) => {
      const input = Buffer.from('Hello, World! '.repeat(100))
      const compressed = await engine.compress(input, algo)
      const decompressed = await engine.decompress(compressed, algo)
      expect(decompressed.toString()).toBe(input.toString())
    })

    it('round-trips binary (embedding-like) data with lz4', async () => {
      const floats = new Float32Array(1536).map((_, i) => Math.sin(i))
      const input = Buffer.from(floats.buffer)
      const compressed = await engine.compress(input, 'lz4')
      const decompressed = await engine.decompress(compressed, 'lz4')
      expect(Buffer.compare(decompressed, input)).toBe(0)
    })
  })

  describe('brotli', () => {
    it('achieves compression on repetitive text', async () => {
      const input = Buffer.from('Hello, World! '.repeat(100))
      const compressed = await engine.compress(input, 'brotli')
      expect(compressed.length).toBeLessThan(input.length)
    })
  })

  describe('none', () => {
    it('returns an independent copy of the input', async () => {
      const input = Buffer.from('data')
      const out = await engine.compress(input, 'none')
      expect(out.toString()).toBe('data')
      out[0] = 0
      expect(input.toString()).toBe('data') // original untouched
    })
  })

  describe('selectAlgo', () => {
    it('uses none for tiny payloads', () => {
      expect(engine.selectAlgo(4)).toBe('none')
    })
    it('uses lz4 for medium payloads', () => {
      expect(engine.selectAlgo(10_000)).toBe('lz4')
    })
    it('uses lz4 exactly at the 50KB boundary', () => {
      expect(engine.selectAlgo(50 * 1024)).toBe('lz4')
    })
    it('uses brotli above 50KB', () => {
      expect(engine.selectAlgo(50 * 1024 + 1)).toBe('brotli')
    })
    it('forces lz4 for the embedding hint regardless of size', () => {
      expect(engine.selectAlgo(100_000, 'embedding')).toBe('lz4')
      expect(engine.selectAlgo(4, 'embedding')).toBe('lz4')
    })
    it('forces brotli for the text hint regardless of size', () => {
      expect(engine.selectAlgo(4, 'text')).toBe('brotli')
    })
    it('falls back to size rules for json/binary hints', () => {
      expect(engine.selectAlgo(10_000, 'json')).toBe('lz4')
      expect(engine.selectAlgo(4, 'binary')).toBe('none')
    })
  })

  describe('auto', () => {
    it('skips compression for small payloads', async () => {
      const result = await engine.auto(Buffer.from('tiny'))
      expect(result.algo).toBe('none')
    })

    it('uses lz4 for medium payloads', async () => {
      const result = await engine.auto(Buffer.alloc(10_000, 'x'))
      expect(result.algo).toBe('lz4')
    })

    it('uses brotli for large text', async () => {
      const result = await engine.auto(Buffer.from('word '.repeat(20_000)), 'text')
      expect(result.algo).toBe('brotli')
    })

    it('uses lz4 for embedding hint', async () => {
      const result = await engine.auto(Buffer.alloc(100_000), 'embedding')
      expect(result.algo).toBe('lz4')
    })

    it('reports size, ratio, and timing in the result', async () => {
      const input = Buffer.from('word '.repeat(20_000))
      const result = await engine.auto(input, 'text')
      expect(result.originalSize).toBe(input.length)
      expect(result.compressedSize).toBe(result.data.length)
      expect(result.ratio).toBeGreaterThan(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('produces output that decompresses back to the original', async () => {
      const input = Buffer.from('round trip via auto '.repeat(5000))
      const result = await engine.auto(input)
      const restored = await engine.decompress(result.data, result.algo)
      expect(restored.toString()).toBe(input.toString())
    })
  })

  describe('stats', () => {
    it('calculates compression ratio correctly', () => {
      const stats = engine.stats(Buffer.alloc(1000), Buffer.alloc(400))
      expect(stats.ratio).toBeCloseTo(2.5)
      expect(stats.savedBytes).toBe(600)
      expect(stats.savedPercent).toBe(60)
    })

    it('reports a neutral result for an empty original', () => {
      const stats = engine.stats(Buffer.alloc(0), Buffer.alloc(0))
      expect(stats.ratio).toBe(1)
      expect(stats.savedBytes).toBe(0)
      expect(stats.savedPercent).toBe(0)
    })

    it('reports Infinity ratio when compressed is empty', () => {
      const stats = engine.stats(Buffer.alloc(100), Buffer.alloc(0))
      expect(stats.ratio).toBe(Infinity)
    })
  })

  describe('error handling', () => {
    it('throws when compress is called with auto', async () => {
      await expect(engine.compress(Buffer.from('x'), 'auto')).rejects.toThrow(CompressionError)
    })

    it('throws when decompress is called with auto', async () => {
      await expect(engine.decompress(Buffer.from('x'), 'auto')).rejects.toThrow(CompressionError)
    })

    it('throws for zstd on compress and decompress', async () => {
      await expect(engine.compress(Buffer.from('x'), 'zstd')).rejects.toThrow(CompressionError)
      await expect(engine.decompress(Buffer.from('x'), 'zstd')).rejects.toThrow(CompressionError)
    })

    it('throws CompressionError for an unknown algorithm', async () => {
      await expect(
        engine.compress(Buffer.from('x'), 'bogus' as CompressionAlgo),
      ).rejects.toThrow(CompressionError)
      await expect(
        engine.decompress(Buffer.from('x'), 'bogus' as CompressionAlgo),
      ).rejects.toThrow(CompressionError)
    })

    it('throws CompressionError when lz4 decompresses garbage', async () => {
      const garbage = Buffer.from([0xff, 0x00, 0x12, 0x34, 0x56])
      await expect(engine.decompress(garbage, 'lz4')).rejects.toThrow(CompressionError)
    })
  })
})
