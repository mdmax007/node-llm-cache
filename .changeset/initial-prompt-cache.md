---
"@nodellmcache/prompt-cache": minor
---

Initial release of `@nodellmcache/prompt-cache`: a `PromptCache` extending `BaseCacheManager` for LLM prompt/response caching. Normalized, hashed, provider/model-namespaced keys; 24h default TTL with per-provider and per-call overrides; token-savings and estimated-USD-savings tracking (pluggable token counter and pricing table); and `warm()` for pre-populating prompts. Storage adapter is injected.
