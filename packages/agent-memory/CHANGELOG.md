# @nodellmcache/agent-memory

## 1.0.0

### Minor Changes

- 88ec6cd: Initial release of `@nodellmcache/agent-memory`: persistent, per-agent memory with long-term types (episodic, semantic, procedural) and transient working memory. `store`/`recall`/`forget`/`summarize` for long-term memory, `storeWorking`/`getWorkingMemory`/`clearWorkingMemory` for scratch state, and `clear`. Recall ranks by cosine similarity when an `embeddingFn` is configured (via `@nodellmcache/semantic-cache`), otherwise by keyword overlap, tie-broken by importance and recency. State persists in the injected storage adapter (one record per agent), so a persistent backend survives restarts.

### Patch Changes

- Updated dependencies [a2633d8]
- Updated dependencies [aace6f1]
  - @nodellmcache/core@1.0.0
  - @nodellmcache/semantic-cache@1.0.0
