import { describe, it, expect, beforeEach } from 'vitest'
import { attachOtel, type MeterLike } from '../otel.js'
import { MetricsCollector } from '@nodellmcache/observability'

interface Recorded {
  counters: Record<string, Array<{ value: number; attrs?: Record<string, string | number> }>>
  histograms: Record<string, Array<{ value: number; attrs?: Record<string, string | number> }>>
}

function fakeMeter(): { meter: MeterLike; recorded: Recorded } {
  const recorded: Recorded = { counters: {}, histograms: {} }
  const meter: MeterLike = {
    createCounter(name) {
      recorded.counters[name] = []
      return { add: (value, attrs) => recorded.counters[name]!.push({ value, attrs }) }
    },
    createHistogram(name) {
      recorded.histograms[name] = []
      return { record: (value, attrs) => recorded.histograms[name]!.push({ value, attrs }) }
    },
  }
  return { meter, recorded }
}

describe('attachOtel', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = new MetricsCollector()
  })

  it('records a hit as a request counter + latency histogram + tokens saved', () => {
    const { meter, recorded } = fakeMeter()
    attachOtel(collector, { meter })

    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1.5, tokensSaved: 100 })

    expect(recorded.counters['nodellmcache.cache.requests']).toEqual([
      { value: 1, attrs: { result: 'hit', cache_type: 'prompt' } },
    ])
    expect(recorded.histograms['nodellmcache.cache.latency']).toEqual([
      { value: 1.5, attrs: { cache_type: 'prompt' } },
    ])
    expect(recorded.counters['nodellmcache.cache.tokens_saved']).toEqual([
      { value: 100, attrs: { cache_type: 'prompt' } },
    ])
  })

  it('records a miss as a request counter + latency, no tokens', () => {
    const { meter, recorded } = fakeMeter()
    attachOtel(collector, { meter })
    collector.emit('cache.miss', { cacheType: 'embedding', latencyMs: 0.2 })
    expect(recorded.counters['nodellmcache.cache.requests']).toEqual([
      { value: 1, attrs: { result: 'miss', cache_type: 'embedding' } },
    ])
    expect(recorded.counters['nodellmcache.cache.tokens_saved']).toEqual([]) // none on a miss
  })

  it('records sets and evictions', () => {
    const { meter, recorded } = fakeMeter()
    attachOtel(collector, { meter })
    collector.emit('cache.set', { cacheType: 'prompt', latencyMs: 0 })
    collector.emit('cache.evict', { cacheType: 'prompt', latencyMs: 0 })
    expect(recorded.counters['nodellmcache.cache.sets']).toHaveLength(1)
    expect(recorded.counters['nodellmcache.cache.evictions']).toHaveLength(1)
  })

  it('omits tokens_saved when a hit has none', () => {
    const { meter, recorded } = fakeMeter()
    attachOtel(collector, { meter })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(recorded.counters['nodellmcache.cache.tokens_saved']).toEqual([])
  })

  it('honors a custom prefix', () => {
    const { meter, recorded } = fakeMeter()
    attachOtel(collector, { meter, prefix: 'myapp' })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(recorded.counters['myapp.cache.requests']).toHaveLength(1)
  })

  it('detach() stops recording further events', () => {
    const { meter, recorded } = fakeMeter()
    const handle = attachOtel(collector, { meter })
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    handle.detach()
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    expect(recorded.counters['nodellmcache.cache.requests']).toHaveLength(1) // only the first
  })

  it('falls back to the global meter when none is injected', () => {
    // No SDK configured -> OTel API returns a no-op meter; should not throw.
    const handle = attachOtel(collector)
    expect(() => collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })).not.toThrow()
    handle.detach()
  })
})
