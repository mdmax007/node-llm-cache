import { describe, it, expect, afterEach } from 'vitest'
import { startDashboard, type DashboardHandle } from '../dashboard.js'
import { MetricsCollector } from '@nodellmcache/observability'

let handle: DashboardHandle | undefined

afterEach(async () => {
  await handle?.close()
  handle = undefined
})

describe('startDashboard', () => {
  it('serves the HTML page', async () => {
    handle = await startDashboard({ port: 0, collector: new MetricsCollector() })
    const res = await fetch(handle.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('NODELLMCACHE')
    expect(html).toContain('/api/stream')
  })

  it('serves a metrics snapshot reflecting the collector', async () => {
    const collector = new MetricsCollector()
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1, tokensSaved: 100 })
    collector.emit('cache.miss', { cacheType: 'prompt', latencyMs: 2 })
    handle = await startDashboard({ port: 0, collector })

    const snap = (await (await fetch(`${handle.url}/api/snapshot`)).json()) as {
      hits: number
      misses: number
      hitRate: number
      tokensSaved: number
      byType: Record<string, { hits: number }>
    }
    expect(snap.hits).toBe(1)
    expect(snap.misses).toBe(1)
    expect(snap.hitRate).toBeCloseTo(0.5)
    expect(snap.tokensSaved).toBe(100)
    expect(snap.byType.prompt?.hits).toBe(1)
  })

  it('returns 500 when the collector snapshot fails', async () => {
    const collector = new MetricsCollector()
    collector.snapshot = () => Promise.reject(new Error('boom'))
    handle = await startDashboard({ port: 0, collector })
    const res = await fetch(`${handle.url}/api/snapshot`)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('boom')
  })

  it('serves compression stats', async () => {
    const collector = new MetricsCollector()
    collector.recordCompression({ originalSize: 1000, compressedSize: 250 })
    handle = await startDashboard({ port: 0, collector })

    const cs = (await (await fetch(`${handle.url}/api/compression`)).json()) as {
      ratio: number
      samples: number
    }
    expect(cs.ratio).toBeCloseTo(4)
    expect(cs.samples).toBe(1)
  })

  it('streams snapshots over SSE and pushes on cache activity', async () => {
    const collector = new MetricsCollector()
    handle = await startDashboard({ port: 0, collector, pollIntervalMs: 50 })

    const controller = new AbortController()
    const res = await fetch(`${handle.url}/api/stream`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('data:')
    const payload = JSON.parse(first.replace(/^data:\s*/, '').split('\n')[0]!.trim()) as Record<string, unknown>
    expect(payload).toHaveProperty('hitRate')
    expect(payload).toHaveProperty('compression')

    // Emit activity -> the stream should push another frame promptly.
    collector.emit('cache.hit', { cacheType: 'prompt', latencyMs: 1 })
    const next = new TextDecoder().decode((await reader.read()).value)
    expect(next).toContain('data:')

    controller.abort()
    await reader.cancel().catch(() => {})
    // Give the server a tick to run its req 'close' cleanup.
    await new Promise((r) => setTimeout(r, 30))
  })

  it('reports the bound port and url', async () => {
    handle = await startDashboard({ port: 0, collector: new MetricsCollector() })
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.url).toContain(String(handle.port))
  })
})
