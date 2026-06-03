---
"@nodellmcache/agent-memory": minor
---

Initial release of `@nodellmcache/agent-memory`: persistent, per-agent memory with long-term types (episodic, semantic, procedural) and transient working memory. `store`/`recall`/`forget`/`summarize` for long-term memory, `storeWorking`/`getWorkingMemory`/`clearWorkingMemory` for scratch state, and `clear`. Recall ranks by cosine similarity when an `embeddingFn` is configured (via `@nodellmcache/semantic-cache`), otherwise by keyword overlap, tie-broken by importance and recency. State persists in the injected storage adapter (one record per agent), so a persistent backend survives restarts.
