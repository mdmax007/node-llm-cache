import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PromptCache } from '../PromptCache.js'
import { MemoryAdapter } from '@nodellmcache/memory'
import type { MetricData, MetricEvent } from '@nodellmcache/core'

const DAY = 24 * 60 * 60 * 1000

describe('PromptCache', () => {
  let cache: PromptCache
  let generator: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cache = new PromptCache({ adapter: new MemoryAdapter() })
    generator = vi.fn().mockResolvedValue('mocked response')
  })

  // --- cache-aside behavior (architecture spec) ----------------------------

  it('calls generator on first request (miss)', async () => {
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledOnce()
  })

  it('returns cached value on second request (hit)', async () => {
    await cache.getOrGenerate('hello', generator)
    const result = await cache.getOrGenerate('hello', generator)
    expect(result).toBe('mocked response')
    expect(generator).toHaveBeenCalledOnce()
  })

  it('treats normalized prompts as the same key', async () => {
    await cache.getOrGenerate('hello world', generator)
    await cache.getOrGenerate('  Hello   World  ', generator)
    expect(generator).toHaveBeenCalledOnce()
  })

  it('differentiates by model', async () => {
    await cache.getOrGenerate('hello', generator, { model: 'gpt-4o' })
    await cache.getOrGenerate('hello', generator, { model: 'gpt-3.5-turbo' })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('differentiates by provider', async () => {
    await cache.getOrGenerate('hello', generator, { provider: 'openai', model: 'm' })
    await cache.getOrGenerate('hello', generator, { provider: 'anthropic', model: 'm' })
    expect(generator).toHaveBeenCalledTimes(2)
  })

  it('respects TTL expiry', async () => {
    vi.useFakeTimers()
    cache = new PromptCache({ adapter: new MemoryAdapter(), defaultTTL: 1000 })
    await cache.getOrGenerate('hello', generator)
    vi.advanceTimersByTime(2000)
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('tracks hit and miss stats', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.getOrGenerate('hello', generator)
    const stats = await cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('invalidates a cache entry', async () => {
    await cache.getOrGenerate('hello', generator)
    await cache.invalidate('hello')
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2)
  })

  // --- defaults ------------------------------------------------------------

  it('defaults to a 24h TTL', async () => {
    vi.useFakeTimers()
    await cache.getOrGenerate('hello', generator)
    vi.advanceTimersByTime(23 * 60 * 60 * 1000)
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledOnce() // still cached at 23h
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    await cache.getOrGenerate('hello', generator)
    expect(generator).toHaveBeenCalledTimes(2) // expired after 24h
    vi.useRealTimers()
  })

  // --- per-provider TTL ----------------------------------------------------

  it('applies a per-provider TTL override', async () => {
    vi.useFakeTimers()
    cache = new PromptCache({
      adapter: new MemoryAdapter(),
      defaultTTL: DAY,
      ttlByProvider: { openai: 1000 },
    })
    await cache.getOrGenerate('hello', generator, { provider: 'openai', model: 'gpt-4o' })
    vi.advanceTimersByTime(1500)
    await cache.getOrGenerate('hello', generator, { provider: 'openai', model: 'gpt-4o' })
    expect(generator).toHaveBeenCalledTimes(2) // expired per openai 1s override
    vi.useRealTimers()
  })

  it('lets an explicit ttl beat the per-provider override', async () => {
    vi.useFakeTimers()
    cache = new PromptCache({
      adapter: new MemoryAdapter(),
      ttlByProvider: { openai: 100_000 },
    })
    await cache.getOrGenerate('hi', generator, { provider: 'openai', model: 'm', ttl: 500 })
    vi.advanceTimersByTime(800)
    await cache.getOrGenerate('hi', generator, { provider: 'openai', model: 'm', ttl: 500 })
    expect(generator).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // --- token & cost tracking ----------------------------------------------

  it('tracks tokens saved on hits', async () => {
    generator.mockResolvedValue('a'.repeat(400)) // ~100 tokens at 4 chars/token
    await cache.getOrGenerate('q', generator)
    let stats = await cache.stats()
    expect(stats.tokensSaved).toBe(0) // miss saves nothing
    await cache.getOrGenerate('q', generator)
    stats = await cache.stats()
    expect(stats.tokensSaved).toBe(100)
  })

  it('estimates USD savings from the pricing table', async () => {
    generator.mockResolvedValue('x'.repeat(4_000_000)) // ~1M tokens
    await cache.getOrGenerate('q', generator, { provider: 'openai', model: 'gpt-4o' })
    await cache.getOrGenerate('q', generator, { provider: 'openai', model: 'gpt-4o' })
    const stats = await cache.stats()
    expect(stats.tokensSaved).toBe(1_000_000)
    expect(stats.estimatedSavingsUSD).toBeCloseTo(10, 5) // gpt-4o default $10 / 1M
  })

  it('honors a custom pricing override', async () => {
    cache = new PromptCache({
      adapter: new MemoryAdapter(),
      pricing: { 'openai:gpt-4o': 100 },
    })
    generator.mockResolvedValue('x'.repeat(4_000_000))
    await cache.getOrGenerate('q', generator, { provider: 'openai', model: 'gpt-4o' })
    await cache.getOrGenerate('q', generator, { provider: 'openai', model: 'gpt-4o' })
    const stats = await cache.stats()
    expect(stats.estimatedSavingsUSD).toBeCloseTo(100, 5)
  })

  it('uses an injected token counter', async () => {
    const countTokens = vi.fn().mockReturnValue(42)
    cache = new PromptCache({ adapter: new MemoryAdapter(), countTokens })
    await cache.getOrGenerate('q', generator)
    await cache.getOrGenerate('q', generator)
    expect(countTokens).toHaveBeenCalledWith('mocked response')
    expect((await cache.stats()).tokensSaved).toBe(42)
  })

  it('respects an explicit tokenCount in options', async () => {
    await cache.getOrGenerate('q', generator, { tokenCount: 999 })
    await cache.getOrGenerate('q', generator, { tokenCount: 999 })
    expect((await cache.stats()).tokensSaved).toBe(999)
  })

  // --- warming -------------------------------------------------------------

  it('warms a list of prompts, generating each once', async () => {
    const gen = vi.fn().mockImplementation((p: string) => Promise.resolve(`ans:${p}`))
    const generated = await cache.warm(['a', 'b', 'c'], gen)
    expect(generated).toBe(3)
    expect(gen).toHaveBeenCalledTimes(3)
    // All now cached: a second warm generates nothing.
    const again = await cache.warm(['a', 'b', 'c'], gen)
    expect(again).toBe(0)
    expect(gen).toHaveBeenCalledTimes(3)
  })

  it('serves warmed prompts from cache', async () => {
    await cache.warm(['hello'], () => Promise.resolve('warmed'))
    const result = await cache.getOrGenerate('hello', generator)
    expect(result).toBe('warmed')
    expect(generator).not.toHaveBeenCalled()
  })

  // --- metrics forwarding --------------------------------------------------

  it('forwards events to a downstream metrics sink', async () => {
    const events: MetricEvent[] = []
    const sink = { emit: (e: MetricEvent, _d: MetricData) => events.push(e) }
    cache = new PromptCache({ adapter: new MemoryAdapter(), metrics: sink })
    await cache.getOrGenerate('hello', generator)
    await cache.getOrGenerate('hello', generator)
    expect(events).toContain('cache.miss')
    expect(events).toContain('cache.set')
    expect(events).toContain('cache.hit')
  })

  it('caches non-string values too', async () => {
    const objCache = new PromptCache<{ answer: number }>({ adapter: new MemoryAdapter() })
    const gen = vi.fn().mockResolvedValue({ answer: 42 })
    await objCache.getOrGenerate('q', gen)
    const result = await objCache.getOrGenerate('q', gen)
    expect(result).toEqual({ answer: 42 })
    expect(gen).toHaveBeenCalledOnce()
  })

  it('tolerates non-serializable values when counting tokens', async () => {
    type Circular = { self?: unknown }
    const objCache = new PromptCache<Circular>({ adapter: new MemoryAdapter() })
    const circular: Circular = {}
    circular.self = circular
    const gen = vi.fn().mockResolvedValue(circular)
    // buildEntry -> asText -> JSON.stringify throws -> falls back to String(value)
    await expect(objCache.getOrGenerate('q', gen)).resolves.toBe(circular)
  })
})
