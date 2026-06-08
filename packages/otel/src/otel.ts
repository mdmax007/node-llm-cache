import { metrics as otelMetrics } from '@opentelemetry/api'
import { observability } from '@nodellmcache/observability'
import type { MetricsCollector } from '@nodellmcache/observability'
import type { MetricData } from '@nodellmcache/core'

/**
 * The slice of the OpenTelemetry `Meter` API this bridge uses. The real
 * `@opentelemetry/api` Meter satisfies it structurally; tests inject a fake.
 */
export interface MeterLike {
  createCounter(
    name: string,
    options?: { description?: string; unit?: string },
  ): { add(value: number, attributes?: Record<string, string | number>): void }
  createHistogram(
    name: string,
    options?: { description?: string; unit?: string },
  ): { record(value: number, attributes?: Record<string, string | number>): void }
}

export interface AttachOtelOptions {
  /** Meter to record into. Defaults to `metrics.getMeter(meterName)` from the OTel API. */
  meter?: MeterLike
  /** Meter name when one isn't injected. Default `@nodellmcache/otel`. */
  meterName?: string
  /** Instrument name prefix. Default `nodellmcache`. */
  prefix?: string
}

export interface OtelHandle {
  /** Removes the listeners, stopping the export. */
  detach(): void
}

/**
 * Bridges a {@link MetricsCollector} to OpenTelemetry: subscribes to cache
 * events and records standard instruments (request counter with hit/miss +
 * cache-type attributes, latency histogram, tokens-saved and eviction counters).
 *
 * Works whether or not an OTel SDK/MeterProvider is configured — with none, the
 * API uses a no-op meter. Configure your own exporter (OTLP, Prometheus, ...) to
 * actually ship the data.
 *
 * ```ts
 * import { attachOtel } from '@nodellmcache/otel'
 * const handle = attachOtel() // bridges the shared observability singleton
 * ```
 */
export function attachOtel(
  collector: MetricsCollector = observability,
  options: AttachOtelOptions = {},
): OtelHandle {
  const prefix = options.prefix ?? 'nodellmcache'
  const meter =
    options.meter ?? (otelMetrics.getMeter(options.meterName ?? '@nodellmcache/otel') as MeterLike)

  const requests = meter.createCounter(`${prefix}.cache.requests`, {
    description: 'Cache requests by result (hit/miss)',
  })
  const latency = meter.createHistogram(`${prefix}.cache.latency`, {
    description: 'Cache read latency',
    unit: 'ms',
  })
  const tokensSaved = meter.createCounter(`${prefix}.cache.tokens_saved`, {
    description: 'Tokens served from cache instead of regenerated',
  })
  const sets = meter.createCounter(`${prefix}.cache.sets`, { description: 'Cache writes' })
  const evictions = meter.createCounter(`${prefix}.cache.evictions`, {
    description: 'Cache evictions',
  })

  const onHit = (d: MetricData): void => {
    requests.add(1, { result: 'hit', cache_type: d.cacheType })
    latency.record(d.latencyMs, { cache_type: d.cacheType })
    if (d.tokensSaved) tokensSaved.add(d.tokensSaved, { cache_type: d.cacheType })
  }
  const onMiss = (d: MetricData): void => {
    requests.add(1, { result: 'miss', cache_type: d.cacheType })
    latency.record(d.latencyMs, { cache_type: d.cacheType })
  }
  const onSet = (d: MetricData): void => sets.add(1, { cache_type: d.cacheType })
  const onEvict = (d: MetricData): void => evictions.add(1, { cache_type: d.cacheType })

  const offs = [
    collector.on('cache.hit', onHit),
    collector.on('cache.miss', onMiss),
    collector.on('cache.set', onSet),
    collector.on('cache.evict', onEvict),
  ]

  return {
    detach() {
      for (const off of offs) off()
    },
  }
}
