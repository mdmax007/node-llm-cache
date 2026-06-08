# @nodellmcache/dashboard

## 1.0.0

### Minor Changes

- 8a185fc: Initial release of `@nodellmcache/dashboard`: an opt-in real-time metrics dashboard. `startDashboard()` runs a small Express server that serves a self-contained, dark/futuristic UI (inline HTML/CSS/canvas, no CDN) plus JSON (`/api/snapshot`, `/api/compression`) and Server-Sent-Events (`/api/stream`) endpoints fed by a `MetricsCollector`. Shows hit-rate ring + live chart, tokens and USD saved, latency (avg/p99), compression ratio, embeddings reused, and a per-cache-type breakdown. Configurable port/host/collector/interval; returns a handle with `close()`.

### Patch Changes

- Updated dependencies [a2633d8]
- Updated dependencies [aace6f1]
  - @nodellmcache/core@1.0.0
  - @nodellmcache/observability@1.0.0
