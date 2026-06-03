import { describe, it, expect } from 'vitest'
import { resolvePrice, costOf, DEFAULT_PRICING } from '../pricing.js'

describe('resolvePrice', () => {
  it('prefers an exact provider:model match', () => {
    expect(resolvePrice(DEFAULT_PRICING, 'openai', 'gpt-4o')).toBe(10)
  })
  it('falls back to a bare model key', () => {
    expect(resolvePrice({ 'gpt-4o': 7, default: 1 }, undefined, 'gpt-4o')).toBe(7)
  })
  it('falls back to default', () => {
    expect(resolvePrice({ default: 5 }, 'x', 'y')).toBe(5)
  })
  it('returns 0 with no default and no match', () => {
    expect(resolvePrice({}, undefined, undefined)).toBe(0)
  })
})

describe('costOf', () => {
  it('computes USD from a per-1M-token rate', () => {
    expect(costOf(1_000_000, 10)).toBeCloseTo(10)
    expect(costOf(0, 10)).toBe(0)
  })
})
