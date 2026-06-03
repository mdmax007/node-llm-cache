/**
 * The category of data a cache stores. Used in key namespacing and metrics
 * breakdowns so every cached value is attributable to a workload.
 */
export type CacheType =
  | 'prompt'
  | 'embedding'
  | 'semantic'
  | 'retrieval'
  | 'context'
  | 'agent'
  | 'tool'
  | 'conversation'

/**
 * Canonical LLM provider names. See the providers table in CLAUDE.md for the
 * common models associated with each.
 */
export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'llama'
  | 'mistral'
  | 'ollama'

/**
 * Supported compression algorithms. `auto` defers the choice to the
 * compression engine's size/hint heuristics; `none` is a passthrough.
 */
export type CompressionAlgo = 'lz4' | 'brotli' | 'zstd' | 'gzip' | 'none' | 'auto'

/**
 * A hint describing the shape of a payload so the compression engine can pick
 * the best codec (e.g. `embedding` favours lz4, `text` favours brotli).
 */
export type DataHint = 'embedding' | 'text' | 'json' | 'binary'
