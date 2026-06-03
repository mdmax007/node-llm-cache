# @nodellmcache/observability

Metrics, cost estimation, and reporting for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). A `MetricsCollector` that aggregates cache events into hit rates, latency percentiles, tokens/dollars saved, and compression ratios — and a process-wide `observability` singleton you can drop into any cache.

Every cache manager accepts a `metrics` sink; `MetricsCollector` **is** a `MetricsSink`, so wiring it up is one line.

## Install

```bash
npm install @nodellmcache/observability @nodellmcache/core
```

## Quick start

```ts
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

// Inject the shared collector into any cache.
const cache = new PromptCache({ adapter: new MemoryAdapter(), metrics: observability })

// ... use the cache ...

const stats = await observability.snapshot()
// {
//   hits, misses, hitRate, sets, evictions,
//   tokensSaved, estimatedSavingsUSD, embeddingsReused,
//   avgLatencyMs, p95LatencyMs, p99LatencyMs,
//   compressionRatio,
//   byType: { prompt: { hits, misses, sets, evictions }, embedding: { ... } }
// }

observability.printReport() // pretty console summary

// Subscribe to live events
observability.on('cache.hit', (e) => console.log('HIT', e.cacheType))
const unsubscribe = observability.on('cache.miss', (e) => console.log('MISS', e.cacheType))
unsubscribe()
```

## API

| Member | Description |
|--------|-------------|
| `emit(event, data)` | `MetricsSink` entrypoint — called by cache managers |
| `snapshot()` | `Promise<MetricsSnapshot>` — point-in-time aggregate |
| `on(event, fn)` / `off(event, fn)` | Subscribe / unsubscribe; `on` returns an unsubscribe fn |
| `recordCompression({ originalSize, compressedSize })` | Feed compression ratios |
| `compressionStats()` | Aggregate ratio / saved bytes |
| `printReport()` | Pretty console output |
| `reset()` | Clear metrics (keeps listeners) |

### Cost estimation

`estimatedSavingsUSD` is derived from `tokensSaved` and the event's `provider`/`model` against a built-in output-token price table (USD per 1M tokens). Override per collector:

```ts
import { MetricsCollector } from '@nodellmcache/observability'
const collector = new MetricsCollector({ pricing: { 'openai:gpt-4o': 10, default: 8 } })
```

If an event already carries `estimatedCostUSD`, that value is used directly.

### Latency percentiles

`avg`/`p95`/`p99` are computed over recent **read** latencies (hits + misses) using a bounded ring buffer (`maxLatencySamples`, default 10,000) so memory stays flat in long-running processes.

> Pricing tables here and in `@nodellmcache/prompt-cache` are intentionally separate for now; they may be unified in a future release.

## License

MIT
