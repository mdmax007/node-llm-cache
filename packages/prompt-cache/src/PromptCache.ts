import { BaseCacheManager } from '@nodellmcache/core'
import type {
  CacheEntry,
  CacheOptions,
  CacheStats,
  CacheType,
  LLMProvider,
  MetricData,
  MetricEvent,
  MetricsSink,
  StorageAdapter,
} from '@nodellmcache/core'
import { DEFAULT_PRICING, costOf, estimateTokens, resolvePrice } from './pricing.js'

/** 24 hours in milliseconds — the default prompt TTL. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A metrics sink that tallies tokens and dollars saved from cache hits, then
 * forwards every event to an optional downstream sink (e.g. observability).
 */
class SavingsAccountant implements MetricsSink {
  tokensSaved = 0
  estimatedSavingsUSD = 0

  constructor(
    private readonly pricing: Record<string, number>,
    private readonly forward?: MetricsSink,
  ) {}

  emit(event: MetricEvent, data: MetricData): void {
    if (event === 'cache.hit' && data.tokensSaved) {
      this.tokensSaved += data.tokensSaved
      this.estimatedSavingsUSD += costOf(
        data.tokensSaved,
        resolvePrice(this.pricing, data.provider, data.model),
      )
    }
    this.forward?.emit(event, data)
  }
}

/** Hit/miss stats enriched with prompt-cache savings figures. */
export interface PromptCacheStats extends CacheStats {
  /** Total response tokens served from cache instead of regenerated. */
  tokensSaved: number
  /** Estimated USD saved, based on the configured pricing table. */
  estimatedSavingsUSD: number
}

export interface PromptCacheOptions<T = string> {
  /** Storage backend (injected — never imported in business logic). */
  adapter: StorageAdapter<T>
  /** Default relative TTL (ms). Defaults to 24h. */
  defaultTTL?: number
  /** Per-provider TTL overrides (ms), applied when a call has no explicit ttl. */
  ttlByProvider?: Partial<Record<LLMProvider, number>>
  /** Downstream metrics sink (e.g. `@nodellmcache/observability`). */
  metrics?: MetricsSink
  /** Token counter; defaults to a ~4-chars-per-token estimate. */
  countTokens?: (text: string) => number
  /** Output-token pricing (USD per 1M tokens) merged over the defaults. */
  pricing?: Record<string, number>
}

/**
 * Caches LLM prompt → response pairs with a cache-aside flow, normalized keys,
 * per-provider TTLs, and token/cost savings tracking.
 *
 * Keys are built from the (normalized) prompt plus `provider`/`model`, so the
 * same prompt against different models is cached separately and never stored in
 * plaintext (see `KeyBuilder`).
 */
export class PromptCache<T = string> extends BaseCacheManager<T> {
  protected readonly cacheType: CacheType = 'prompt'

  private readonly accountant: SavingsAccountant
  private readonly countTokens: (text: string) => number
  private readonly ttlByProvider: Partial<Record<LLMProvider, number>>

  constructor(options: PromptCacheOptions<T>) {
    const pricing = { ...DEFAULT_PRICING, ...options.pricing }
    const accountant = new SavingsAccountant(pricing, options.metrics)
    super({
      adapter: options.adapter,
      defaultTTL: options.defaultTTL ?? DAY_MS,
      metrics: accountant,
    })
    this.accountant = accountant
    this.countTokens = options.countTokens ?? estimateTokens
    this.ttlByProvider = options.ttlByProvider ?? {}
  }

  override async getOrGenerate(
    input: string,
    generator: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    const ttl = options?.ttl ?? this.ttlFor(options?.provider) ?? this.defaultTTL
    return super.getOrGenerate(input, generator, { ...options, ttl })
  }

  /**
   * Pre-populates the cache for a list of prompts. Prompts already cached are
   * left untouched; only misses invoke the generator. Returns the number of
   * prompts that were generated (cache misses).
   */
  async warm(
    prompts: string[],
    generator: (prompt: string) => Promise<T>,
    options?: CacheOptions,
  ): Promise<number> {
    let generated = 0
    await Promise.all(
      prompts.map(async (prompt) => {
        await this.getOrGenerate(
          prompt,
          async () => {
            generated++
            return generator(prompt)
          },
          options,
        )
      }),
    )
    return generated
  }

  override async stats(): Promise<PromptCacheStats> {
    const base = await super.stats()
    return {
      ...base,
      tokensSaved: this.accountant.tokensSaved,
      estimatedSavingsUSD: this.accountant.estimatedSavingsUSD,
    }
  }

  protected override buildEntry(key: string, value: T, options?: CacheOptions): CacheEntry<T> {
    const entry = super.buildEntry(key, value, options)
    // Record the response's token count so hits can report tokens saved.
    entry.metadata.tokenCount = options?.tokenCount ?? this.countTokens(this.asText(value))
    return entry
  }

  private ttlFor(provider?: LLMProvider | string): number | undefined {
    if (!provider) return undefined
    return this.ttlByProvider[provider as LLMProvider]
  }

  private asText(value: T): string {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value) ?? ''
    } catch {
      return String(value)
    }
  }
}
