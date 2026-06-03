import { describe, it, expect } from 'vitest'
import { estimateTokens, resolvePrice, costOf, DEFAULT_PRICING } from '../pricing.js'

describe('estimateTokens', () => {
  it('is 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })
  it('uses ~4 chars per token (rounding up)', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('resolvePrice', () => {
  it('prefers an exact provider:model match', () => {
    expect(resolvePrice(DEFAULT_PRICING, 'openai', 'gpt-4o')).toBe(10)
  })

  it('falls back to a bare model key', () => {
    const pricing = { 'gpt-4o': 7, default: 1 }
    expect(resolvePrice(pricing, 'unknownprovider', 'gpt-4o')).toBe(7)
    expect(resolvePrice(pricing, undefined, 'gpt-4o')).toBe(7)
  })

  it('falls back to default when nothing matches', () => {
    expect(resolvePrice({ default: 5 }, 'x', 'y')).toBe(5)
    expect(resolvePrice(DEFAULT_PRICING, 'mystery', 'model')).toBe(DEFAULT_PRICING.default)
  })

  it('returns 0 when there is no default and no match', () => {
    expect(resolvePrice({}, undefined, undefined)).toBe(0)
    expect(resolvePrice({}, 'openai', 'gpt-4o')).toBe(0)
  })
})

describe('costOf', () => {
  it('computes USD from a per-1M-token rate', () => {
    expect(costOf(1_000_000, 10)).toBeCloseTo(10)
    expect(costOf(500_000, 10)).toBeCloseTo(5)
    expect(costOf(0, 10)).toBe(0)
  })
})
