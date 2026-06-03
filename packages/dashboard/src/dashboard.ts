import type { Server } from 'node:http'
import express from 'express'
import { observability } from '@nodellmcache/observability'
import type { MetricsCollector } from '@nodellmcache/observability'
import { renderDashboardHtml } from './render.js'

export interface DashboardOptions {
  /** Port to listen on. Default 4242. Use 0 for an ephemeral port. */
  port?: number
  /** Host/interface to bind. Default `127.0.0.1`. */
  host?: string
  /** Metrics source. Defaults to the shared `observability` singleton. */
  collector?: MetricsCollector
  /** How often (ms) the live stream pushes a fresh snapshot. Default 1000. */
  pollIntervalMs?: number
}

export interface DashboardHandle {
  server: Server
  port: number
  url: string
  /** Stops the server. */
  close(): Promise<void>
}

/**
 * Starts the opt-in metrics dashboard: a small Express server that serves a
 * self-contained UI plus JSON and Server-Sent-Events endpoints fed by a
 * {@link MetricsCollector}. Resolves once the server is listening.
 *
 * ```ts
 * import { startDashboard } from '@nodellmcache/dashboard'
 * await startDashboard() // http://127.0.0.1:4242
 * ```
 */
export function startDashboard(options: DashboardOptions = {}): Promise<DashboardHandle> {
  const collector = options.collector ?? observability
  const port = options.port ?? 4242
  const host = options.host ?? '127.0.0.1'
  const pollIntervalMs = options.pollIntervalMs ?? 1000

  const app = express()

  app.get('/', (_req, res) => {
    res.type('html').send(renderDashboardHtml())
  })

  app.get('/api/snapshot', (_req, res) => {
    collector
      .snapshot()
      .then((snap) => res.json(snap))
      .catch((err: unknown) => res.status(500).json({ error: String(err) }))
  })

  app.get('/api/compression', (_req, res) => {
    res.json(collector.compressionStats())
  })

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const push = (): void => {
      collector
        .snapshot()
        .then((snap) => {
          // The client may have disconnected while the snapshot resolved.
          if (res.writableEnded) return
          res.write(`data: ${JSON.stringify({ ...snap, compression: collector.compressionStats() })}\n\n`)
        })
        .catch(() => undefined)
    }

    push()
    const timer = setInterval(push, pollIntervalMs)
    timer.unref?.()
    // Push immediately on cache activity for a snappier feel.
    const onEvent = (): void => push()
    collector.on('cache.hit', onEvent)
    collector.on('cache.miss', onEvent)

    req.on('close', () => {
      clearInterval(timer)
      collector.off('cache.hit', onEvent)
      collector.off('cache.miss', onEvent)
      res.end()
    })
  })

  return new Promise<DashboardHandle>((resolve) => {
    const server = app.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      resolve({
        server,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
  })
}
