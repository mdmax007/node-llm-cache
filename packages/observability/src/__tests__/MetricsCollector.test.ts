import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MetricsCollector } from '../MetricsCollector.js'

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = new MetricsCollector()
  })

  it('tracks hits and misses', async () => {
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    collector.emit('cache.miss', { cacheType: 'prompt', latencyMs: 5 })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })

    const snap = await collector.snapshot()
    expect(snap.hits).toBe(2)
    expect(snap.misses).toBe(1)
    expect(snap.hitRate).toBeCloseTo(0.667, 2)
  })

  it('tracks per-type breakdowns', async () => {
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    collector.emit('cache.hit', { cacheType: 'embedding', latencyMs: 1 })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })

    const snap = await collector.snapshot()
    expect(snap.byType.prompt?.hits).toBe(2)
    expect(snap.byType.embedding?.hits).toBe(1)
  })

  it('calculates latency percentiles', async () => {
    const latencies = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    latencies.forEach((ms) => collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: ms }))
    const snap = await collector.snapshot()
    expect(snap.p99LatencyMs).toBeGreaterThan(50)
    expect(snap.avgLatencyMs).toBeCloseTo(14.5, 0)
  })

  it('tracks tokens saved', async () => {
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1, tokensSaved: 1500 })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1, tokensSaved: 2000 })
    const snap = await collector.snapshot()
    expect(snap.tokensSaved).toBe(3500)
  })

  it('fires event listeners', async () => {
    const hits: unknown[] = []
    collector.on('cache.hit', (e) => hits.push(e))
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(hits).toHaveLength(1)
  })

  // --- beyond the architecture spec ---------------------------------------

  it('returns an unsubscribe function from on()', () => {
    let count = 0
    const unsub = collector.on('cache.hit', () => count++)
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    unsub()
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(count).toBe(1)
  })

  it('off() removes a listener', () => {
    let count = 0
    const fn = () => count++
    collector.on('cache.miss', fn)
    collector.off('cache.miss', fn)
    collector.emit('cache.miss', { cacheType: 'prompt', latencyMs: 1 })
    expect(count).toBe(0)
  })

  it('tracks sets and evictions overall and per type', async () => {
    collector.emit('cache.set', { cacheType: 'prompt', latencyMs: 0 })
    collector.emit('cache.evict', { cacheType: 'embedding', latencyMs: 0 })
    const snap = await collector.snapshot()
    expect(snap.sets).toBe(1)
    expect(snap.evictions).toBe(1)
    expect(snap.byType.prompt?.sets).toBe(1)
    expect(snap.byType.embedding?.evictions).toBe(1)
  })

  it('estimates USD savings from tokens, provider, and model', async () => {
    collector.emit('cache.hit', {
      cacheType: 'prompt',
      latencyMs: 1,
      tokensSaved: 1_000_000,
      provider: 'openai',
      model: 'gpt-4o',
    })
    const snap = await collector.snapshot()
    expect(snap.estimatedSavingsUSD).toBeCloseTo(10, 5) // $10 / 1M for gpt-4o
  })

  it('prefers an explicit estimatedCostUSD on the event', async () => {
    collector.emit('cache.hit', {
      cacheType: 'prompt',
      latencyMs: 1,
      tokensSaved: 100,
      estimatedCostUSD: 0.5,
    })
    const snap = await collector.snapshot()
    expect(snap.estimatedSavingsUSD).toBeCloseTo(0.5, 5)
  })

  it('honors a custom pricing table', async () => {
    collector = new MetricsCollector({ pricing: { 'openai:gpt-4o': 100 } })
    collector.emit('cache.hit', {
      cacheType: 'prompt',
      latencyMs: 1,
      tokensSaved: 1_000_000,
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect((await collector.snapshot()).estimatedSavingsUSD).toBeCloseTo(100, 5)
  })

  it('reports embeddingsReused from embedding hits', async () => {
    collector.emit('cache.hit', { cacheType: 'embedding', latencyMs: 1 })
    collector.emit('cache.hit', { cacheType: 'embedding', latencyMs: 1 })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect((await collector.snapshot()).embeddingsReused).toBe(2)
  })

  it('aggregates compression stats', () => {
    collector.recordCompression({ originalSize: 1000, compressedSize: 250 })
    collector.recordCompression({ originalSize: 1000, compressedSize: 250 })
    const cs = collector.compressionStats()
    expect(cs.samples).toBe(2)
    expect(cs.ratio).toBeCloseTo(4)
    expect(cs.savedBytes).toBe(1500)
    expect(cs.savedPercent).toBe(75)
  })

  it('reports a neutral compression ratio when nothing recorded', async () => {
    const cs = collector.compressionStats()
    expect(cs.ratio).toBe(1)
    expect(cs.savedPercent).toBe(0)
    expect((await collector.snapshot()).compressionRatio).toBe(1)
  })

  it('snapshot defaults are zero on a fresh collector', async () => {
    const snap = await collector.snapshot()
    expect(snap).toMatchObject({
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
    })
  })

  it('reset() clears metrics but keeps listeners', async () => {
    let count = 0
    collector.on('cache.hit', () => count++)
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1, tokensSaved: 50 })
    collector.reset()
    const snap = await collector.snapshot()
    expect(snap.hits).toBe(0)
    expect(snap.tokensSaved).toBe(0)
    // listener still attached
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(count).toBe(2)
  })

  it('retains only the most recent latency samples (ring buffer)', async () => {
    collector = new MetricsCollector({ maxLatencySamples: 3 })
    ;[10, 10, 10, 100, 100, 100].forEach((ms) =>
      collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: ms }),
    )
    // Only the last 3 (all 100) remain.
    expect((await collector.snapshot()).avgLatencyMs).toBe(100)
  })

  it('printReport writes to the console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 2, tokensSaved: 100 })
    collector.recordCompression({ originalSize: 100, compressedSize: 40 })
    collector.printReport()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]![0]).toContain('NodeLLMCache metrics')
    spy.mockRestore()
  })
})
