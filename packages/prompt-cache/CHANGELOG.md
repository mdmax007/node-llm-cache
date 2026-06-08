# @nodellmcache/prompt-cache

## 1.0.0

### Minor Changes

- aace6f1: Initial release of `@nodellmcache/prompt-cache`: a `PromptCache` extending `BaseCacheManager` for LLM prompt/response caching. Normalized, hashed, provider/model-namespaced keys; 24h default TTL with per-provider and per-call overrides; token-savings and estimated-USD-savings tracking (pluggable token counter and pricing table); and `warm()` for pre-populating prompts. Storage adapter is injected.

### Patch Changes

- Updated dependencies [a2633d8]
  - @nodellmcache/core@1.0.0
