import type {
  CacheType,
  CompressionStats,
  MetricData,
  MetricEvent,
  MetricsSink,
} from '@nodellmcache/core'
import { DEFAULT_PRICING, costOf, resolvePrice } from './pricing.js'

/** Per-cache-type event tally. */
export interface TypeBreakdown {
  hits: number
  misses: number
  sets: number
  evictions: number
}

/** Aggregate compression figures across all recorded operations. */
export interface CompressionSummary {
  samples: number
  totalOriginalBytes: number
  totalCompressedBytes: number
  ratio: number
  savedBytes: number
  savedPercent: number
}

/** A point-in-time view of all collected metrics. */
export interface MetricsSnapshot {
  hits: number
  misses: number
  sets: number
  evictions: number
  hitRate: number
  tokensSaved: number
  estimatedSavingsUSD: number
  embeddingsReused: number
  avgLatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  compressionRatio: number
  byType: Partial<Record<CacheType, TypeBreakdown>>
}

export interface MetricsCollectorOptions {
  /** Output-token pricing (USD per 1M tokens) merged over the defaults. */
  pricing?: Record<string, number>
  /** Max read-latency samples retained for percentile math (ring buffer). Default 10_000. */
  maxLatencySamples?: number
}

type Listener = (data: MetricData) => void

/**
 * Central metrics event bus and aggregator. Implements `MetricsSink`, so it can
 * be injected directly into any cache manager's `metrics` option. Collects
 * hit/miss/set/evict counts (overall and per cache type), read-latency
 * percentiles, tokens and dollars saved, and compression ratios; supports event
 * subscription and a pretty console report.
 */
export class MetricsCollector implements MetricsSink {
  private readonly pricing: Record<string, number>
  private readonly maxLatencySamples: number

  private hits = 0
  private misses = 0
  private sets = 0
  private evictions = 0
  private tokensSaved = 0
  private estimatedSavingsUSD = 0

  private readonly byType = new Map<CacheType, TypeBreakdown>()
  private readonly listeners = new Map<MetricEvent, Set<Listener>>()

  // Read-latency ring buffer (hits + misses).
  private latencies: number[] = []
  private latencyPos = 0

  // Compression accumulators.
  private compSamples = 0
  private compOriginal = 0
  private compCompressed = 0

  constructor(options: MetricsCollectorOptions = {}) {
    this.pricing = { ...DEFAULT_PRICING, ...options.pricing }
    this.maxLatencySamples = options.maxLatencySamples ?? 10_000
  }

  emit(event: MetricEvent, data: MetricData): void {
    switch (event) {
      case 'cache.hit': {
        this.hits++
        this.tally(data.cacheType, 'hits')
        this.recordLatency(data.latencyMs)
        if (data.tokensSaved) {
          this.tokensSaved += data.tokensSaved
          this.estimatedSavingsUSD +=
            data.estimatedCostUSD ??
            costOf(data.tokensSaved, resolvePrice(this.pricing, data.provider, data.model))
        }
        break
      }
      case 'cache.miss':
        this.misses++
        this.tally(data.cacheType, 'misses')
        this.recordLatency(data.latencyMs)
        break
      case 'cache.set':
        this.sets++
        this.tally(data.cacheType, 'sets')
        break
      case 'cache.evict':
        this.evictions++
        this.tally(data.cacheType, 'evictions')
        break
    }
    this.fire(event, data)
  }

  /** Records a compression operation so `compressionRatio` reflects real data. */
  recordCompression(stats: Pick<CompressionStats, 'originalSize' | 'compressedSize'>): void {
    this.compSamples++
    this.compOriginal += stats.originalSize
    this.compCompressed += stats.compressedSize
  }

  /** Subscribes to an event. Returns an unsubscribe function. */
  on(event: MetricEvent, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
    return () => this.off(event, listener)
  }

  /** Unsubscribes a previously registered listener. */
  off(event: MetricEvent, listener: Listener): void {
    this.listeners.get(event)?.delete(listener)
  }

  /** Returns a point-in-time snapshot of all metrics. */
  async snapshot(): Promise<MetricsSnapshot> {
    return this.computeSnapshot()
  }

  /** Returns aggregate compression statistics. */
  compressionStats(): CompressionSummary {
    const ratio = this.compCompressed === 0 ? 1 : this.compOriginal / this.compCompressed
    const savedBytes = this.compOriginal - this.compCompressed
    return {
      samples: this.compSamples,
      totalOriginalBytes: this.compOriginal,
      totalCompressedBytes: this.compCompressed,
      ratio,
      savedBytes,
      savedPercent: this.compOriginal === 0 ? 0 : (savedBytes / this.compOriginal) * 100,
    }
  }

  /** Pretty-prints the current snapshot to the console. */
  printReport(): void {
    const s = this.computeSnapshot()
    const lines = [
      '── NodeLLMCache metrics ──────────────────────',
      `  hit rate        ${(s.hitRate * 100).toFixed(1)}%  (${s.hits} hits / ${s.misses} misses)`,
      `  sets / evicts   ${s.sets} / ${s.evictions}`,
      `  tokens saved    ${s.tokensSaved.toLocaleString()}`,
      `  est. savings    $${s.estimatedSavingsUSD.toFixed(4)}`,
      `  embeddings reused ${s.embeddingsReused.toLocaleString()}`,
      `  latency avg/p95/p99  ${s.avgLatencyMs.toFixed(2)} / ${s.p95LatencyMs.toFixed(2)} / ${s.p99LatencyMs.toFixed(2)} ms`,
      `  compression     ${s.compressionRatio.toFixed(2)}x`,
    ]
    for (const [type, b] of Object.entries(s.byType)) {
      lines.push(`  · ${type.padEnd(12)} ${b!.hits} hits / ${b!.misses} misses`)
    }
    lines.push('──────────────────────────────────────────────')
    // eslint-disable-next-line no-console -- printReport's entire purpose is console output.
    console.log(lines.join('\n'))
  }

  /** Clears all accumulated metrics. Listeners are kept. */
  reset(): void {
    this.hits = 0
    this.misses = 0
    this.sets = 0
    this.evictions = 0
    this.tokensSaved = 0
    this.estimatedSavingsUSD = 0
    this.byType.clear()
    this.latencies = []
    this.latencyPos = 0
    this.compSamples = 0
    this.compOriginal = 0
    this.compCompressed = 0
  }

  // --- internals -----------------------------------------------------------

  private computeSnapshot(): MetricsSnapshot {
    const total = this.hits + this.misses
    const byType: Partial<Record<CacheType, TypeBreakdown>> = {}
    for (const [type, breakdown] of this.byType) byType[type] = { ...breakdown }

    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
      tokensSaved: this.tokensSaved,
      estimatedSavingsUSD: this.estimatedSavingsUSD,
      embeddingsReused: this.byType.get('embedding')?.hits ?? 0,
      avgLatencyMs: this.average(this.latencies),
      p95LatencyMs: this.percentile(this.latencies, 95),
      p99LatencyMs: this.percentile(this.latencies, 99),
      compressionRatio: this.compCompressed === 0 ? 1 : this.compOriginal / this.compCompressed,
      byType,
    }
  }

  private tally(type: CacheType, field: keyof TypeBreakdown): void {
    const b = this.byType.get(type) ?? { hits: 0, misses: 0, sets: 0, evictions: 0 }
    b[field]++
    this.byType.set(type, b)
  }

  private recordLatency(ms: number): void {
    if (this.latencies.length < this.maxLatencySamples) {
      this.latencies.push(ms)
    } else {
      this.latencies[this.latencyPos] = ms
      this.latencyPos = (this.latencyPos + 1) % this.maxLatencySamples
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0
    let sum = 0
    for (const v of values) sum += v
    return sum / values.length
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    // Nearest-rank method.
    const rank = Math.ceil((p / 100) * sorted.length)
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
    return sorted[index]!
  }

  private fire(event: MetricEvent, data: MetricData): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) listener(data)
  }
}

/**
 * Process-wide default collector. Inject it as the `metrics` option of any cache
 * manager to aggregate everything in one place:
 *
 * ```ts
 * import { observability } from '@nodellmcache/observability'
 * new PromptCache({ adapter, metrics: observability })
 * ```
 */
export const observability = new MetricsCollector()
