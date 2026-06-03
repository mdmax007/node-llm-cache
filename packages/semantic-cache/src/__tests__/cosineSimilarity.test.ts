import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '../cosineSimilarity.js'
import { ValidationError } from '@nodellmcache/core'

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
  })

  it('is 1 for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 0], [5, 0])).toBeCloseTo(1)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('is 0 when either vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0)
  })

  it('throws ValidationError on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(ValidationError)
  })
})
