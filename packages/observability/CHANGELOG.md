# @nodellmcache/observability

## 1.0.0

### Minor Changes

- aace6f1: Initial release of `@nodellmcache/observability`: a `MetricsCollector` (and process-wide `observability` singleton) that implements `MetricsSink`, so it drops directly into any cache manager's `metrics` option. Aggregates hit/miss/set/evict counts overall and per cache type, read-latency avg/p95/p99 (bounded ring buffer), tokens and estimated USD saved (pricing table, overridable), `embeddingsReused`, and compression ratios via `recordCompression`. Includes `snapshot()`, `compressionStats()`, `on`/`off` event subscription, `printReport()`, and `reset()`.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
