# @nodellmcache/dashboard

An opt-in, real-time metrics dashboard for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). A tiny Express server serves a self-contained, dark, futuristic UI that streams live cache metrics over Server-Sent Events from `@nodellmcache/observability`.

No build step, no external assets, no CDN: the whole UI is inline HTML/CSS/canvas.

## Install

```bash
npm install @nodellmcache/dashboard @nodellmcache/observability @nodellmcache/core
```

## Quick start

```ts
import { startDashboard } from '@nodellmcache/dashboard'
import { observability } from '@nodellmcache/observability'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

// Point your caches at the shared collector...
const cache = new PromptCache({ adapter: new MemoryAdapter(), metrics: observability })

// ...then open the dashboard.
const dash = await startDashboard() // http://127.0.0.1:4242
// later: await dash.close()
```

By default it reads the shared `observability` singleton, so any cache wired with `metrics: observability` shows up automatically.

## What you get

- **Hit rate** ring + live line chart over time
- **Tokens saved** and **estimated USD saved**
- **Latency** (avg / p99) and **compression ratio**
- **Embeddings reused**
- **Per-cache-type** breakdown

## Endpoints

| Route | Description |
|-------|-------------|
| `GET /` | The dashboard UI |
| `GET /api/snapshot` | Current metrics snapshot (JSON) |
| `GET /api/compression` | Aggregate compression stats (JSON) |
| `GET /api/stream` | Server-Sent Events stream of snapshots |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `4242` | Listen port (`0` for an ephemeral port) |
| `host` | `127.0.0.1` | Bind interface |
| `collector` | `observability` | A `MetricsCollector` to read from |
| `pollIntervalMs` | `1000` | How often the stream pushes a fresh snapshot |

`startDashboard()` resolves to a handle: `{ server, port, url, close() }`.

## License

MIT
