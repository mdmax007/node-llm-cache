import type { LLMProvider } from '@nodellmcache/core'

/**
 * Estimates the token count of a string with the common ~4-characters-per-token
 * heuristic. Good enough for savings estimates; inject a real tokenizer (e.g.
 * `js-tiktoken`) via `PromptCacheOptions.countTokens` when precision matters.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Approximate **output** token prices in USD per 1M tokens, keyed by
 * `provider:model` and, as a looser fallback, by bare `model`. These are
 * indicative defaults for cost-savings estimates — override via
 * `PromptCacheOptions.pricing` for accuracy.
 */
export const DEFAULT_PRICING: Record<string, number> = {
  'openai:gpt-4o': 10,
  'openai:gpt-4-turbo': 30,
  'openai:gpt-3.5-turbo': 1.5,
  'openai:o1': 60,
  'anthropic:claude-3-5-sonnet': 15,
  'anthropic:claude-3-opus': 75,
  'gemini:gemini-1.5-pro': 5,
  'gemini:gemini-2.0-flash': 0.4,
  'deepseek:deepseek-chat': 0.28,
  'mistral:mistral-large': 6,
  default: 10,
}

/** Resolves the per-1M-token price for a provider/model from a pricing table. */
export function resolvePrice(
  pricing: Record<string, number>,
  provider?: LLMProvider | string,
  model?: string,
): number {
  if (provider && model) {
    const exact = pricing[`${provider}:${model}`]
    if (exact !== undefined) return exact
  }
  if (model) {
    const byModel = pricing[model]
    if (byModel !== undefined) return byModel
  }
  return pricing.default ?? 0
}

/** USD cost of a number of tokens at a per-1M-token rate. */
export function costOf(tokens: number, pricePer1M: number): number {
  return (tokens / 1_000_000) * pricePer1M
}
