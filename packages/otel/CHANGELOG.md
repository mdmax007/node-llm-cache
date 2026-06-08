# @nodellmcache/otel

## 1.0.0

### Minor Changes

- Initial release of `@nodellmcache/otel`: `attachOtel(collector?, options?)` bridges a `MetricsCollector` to OpenTelemetry, recording a request counter (hit/miss + cache_type), a latency histogram, and tokens-saved / sets / evictions counters via `@opentelemetry/api`. Safe to attach with no MeterProvider configured (no-op meter); configurable meter, meter name, and instrument prefix; returns `{ detach() }`.

### Patch Changes

- Updated dependencies [a2633d8]
- Updated dependencies [aace6f1]
  - @nodellmcache/core@1.0.0
  - @nodellmcache/observability@1.0.0
