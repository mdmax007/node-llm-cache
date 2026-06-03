import type { LLMProvider } from '@nodellmcache/core'

/**
 * Approximate **output** token prices in USD per 1M tokens, keyed by
 * `provider:model` and, as a looser fallback, by bare `model`. Indicative
 * defaults for cost-savings estimates — override via the collector's `pricing`.
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
