# @nodellmcache/prompt-cache

LLM prompt/response caching for [NodeLLMCache](https://github.com/mdmax007/node-llm-cache). Wraps any model call with a cache-aside layer that normalizes prompts, namespaces by provider/model, and tracks the tokens and dollars you saved.

The storage backend is **injected** — use `@nodellmcache/memory`, `@nodellmcache/redis`, or any `StorageAdapter`.

## Install

```bash
npm install @nodellmcache/prompt-cache @nodellmcache/memory @nodellmcache/core
```

## Quick start

```ts
import OpenAI from 'openai'
import { PromptCache } from '@nodellmcache/prompt-cache'
import { MemoryAdapter } from '@nodellmcache/memory'

const openai = new OpenAI()
const cache = new PromptCache({
  adapter: new MemoryAdapter({ maxSize: 100 * 1024 * 1024 }),
  defaultTTL: 3_600_000, // 1 hour (defaults to 24h)
})

function ask(prompt: string) {
  return cache.getOrGenerate(
    prompt,
    async () => {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      })
      return res.choices[0]!.message.content!
    },
    { provider: 'openai', model: 'gpt-4o' },
  )
}

await ask('Explain Redis in one paragraph') // miss → hits the API
await ask('Explain Redis in one paragraph') // hit → instant, $0

console.log(await cache.stats())
// { hits: 1, misses: 1, hitRate: 0.5, entryCount: 1, tokensSaved: 312, estimatedSavingsUSD: 0.0031 }
```

## Features

- **Normalized keys** — prompts are trimmed, lowercased, whitespace-collapsed, then SHA-256 hashed and namespaced as `prompt:{provider}:{model}:{hash}`. Raw prompt text is never stored in keys.
- **TTL** — 24h default; override per instance with `defaultTTL`, per provider with `ttlByProvider`, or per call with `options.ttl` (precedence: call → provider → default).
- **Token & cost savings** — every hit accrues `tokensSaved` and `estimatedSavingsUSD`. Token counts use a ~4-chars-per-token estimate by default; inject a real tokenizer via `countTokens`.
- **Cache warming** — `warm(prompts, generator)` pre-populates the cache, generating only the misses and returning how many were generated.
- **Observability** — forwards all cache events to a `metrics` sink (e.g. `@nodellmcache/observability`).

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `adapter` | — (required) | Injected `StorageAdapter` |
| `defaultTTL` | `86_400_000` (24h) | Relative TTL in ms |
| `ttlByProvider` | `{}` | Per-provider TTL overrides (ms) |
| `countTokens` | ~4 chars/token | `(text) => number` token counter |
| `pricing` | built-in table | USD per 1M output tokens, merged over defaults |
| `metrics` | no-op | Downstream metrics sink |

### Accurate token counts

```ts
import { encodingForModel } from 'js-tiktoken'
const enc = encodingForModel('gpt-4o')
const cache = new PromptCache({
  adapter: new MemoryAdapter(),
  countTokens: (text) => enc.encode(text).length,
})
```

### Custom pricing

```ts
new PromptCache({
  adapter: new MemoryAdapter(),
  pricing: { 'openai:gpt-4o': 10, 'anthropic:claude-3-5-sonnet': 15, default: 8 },
})
```

> Pricing values are **estimates** for reporting savings, expressed in USD per 1M output tokens, keyed by `provider:model` (falling back to bare `model`, then `default`).

## License

MIT
