import { describe, it, expect } from 'vitest'
import { estimateSize } from '../estimateSize.js'

describe('estimateSize', () => {
  it('returns 0 for null and undefined', () => {
    expect(estimateSize(null)).toBe(0)
    expect(estimateSize(undefined)).toBe(0)
  })

  it('uses byte length for Buffers', () => {
    expect(estimateSize(Buffer.alloc(128))).toBe(128)
  })

  it('uses byte length for typed arrays', () => {
    expect(estimateSize(new Float32Array(10))).toBe(40)
  })

  it('uses byte length for ArrayBuffer', () => {
    expect(estimateSize(new ArrayBuffer(16))).toBe(16)
  })

  it('uses UTF-8 byte length for strings', () => {
    expect(estimateSize('héllo')).toBe(Buffer.byteLength('héllo'))
  })

  it('uses fixed sizes for number, bigint, boolean', () => {
    expect(estimateSize(3.14)).toBe(8)
    expect(estimateSize(10n)).toBe(8)
    expect(estimateSize(true)).toBe(4)
  })

  it('falls back to JSON length for plain objects and arrays', () => {
    const obj = { a: 1, b: 'two' }
    expect(estimateSize(obj)).toBe(Buffer.byteLength(JSON.stringify(obj)))
    expect(estimateSize([1, 2, 3])).toBe(Buffer.byteLength('[1,2,3]'))
  })

  it('returns 0 for non-serializable values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(estimateSize(circular)).toBe(0)
    expect(estimateSize(() => {})).toBe(0) // JSON.stringify -> undefined
  })
})
