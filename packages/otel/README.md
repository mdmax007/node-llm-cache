# @nodellmcache/otel

OpenTelemetry exporter for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache) observability. Bridges a `MetricsCollector` to OpenTelemetry instruments so your cache metrics flow into whatever backend your OTel SDK exports to (OTLP, Prometheus, Datadog, ...).

## Install

```bash
npm install @nodellmcache/otel @nodellmcache/observability @nodellmcache/core @opentelemetry/api
```

## Quick start

```ts
import { attachOtel } from '@nodellmcache/otel'
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

// Your app configures an OTel MeterProvider + exporter as usual.

// Wire cache metrics in (defaults to the shared observability singleton):
const handle = attachOtel()

const cache = new PromptCache({ adapter: new MemoryAdapter(), metrics: observability })
// ...later: handle.detach()
```

Works whether or not a `MeterProvider` is configured — with none, the OTel API uses a no-op meter, so attaching is always safe.

## Instruments

| Instrument | Type | Attributes |
|------------|------|-----------|
| `nodellmcache.cache.requests` | counter | `result` (hit/miss), `cache_type` |
| `nodellmcache.cache.latency` | histogram (ms) | `cache_type` |
| `nodellmcache.cache.tokens_saved` | counter | `cache_type` |
| `nodellmcache.cache.sets` | counter | `cache_type` |
| `nodellmcache.cache.evictions` | counter | `cache_type` |

## Options

```ts
attachOtel(collector, {
  meter,            // a custom OTel Meter (defaults to metrics.getMeter(...))
  meterName,        // name when one isn't injected (default '@nodellmcache/otel')
  prefix,           // instrument name prefix (default 'nodellmcache')
})
```

`attachOtel` returns `{ detach() }` to remove the listeners.

## License

MIT
