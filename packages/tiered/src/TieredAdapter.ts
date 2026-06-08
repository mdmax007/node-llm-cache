import { TTLManager, ValidationError } from '@nodellmcache/core'
import type { AdapterStats, CacheEntry, StorageAdapter } from '@nodellmcache/core'

export interface TieredAdapterOptions<T> {
  /**
   * Storage tiers ordered fastest to slowest, e.g. `[memory, redis]`. Reads walk
   * the tiers in order; writes go to all of them.
   */
  tiers: StorageAdapter<T>[]
}

/**
 * Composes several {@link StorageAdapter}s into one multi-tier cache.
 *
 * - **Read-through with promotion**: `get` checks tiers fastest-first and, on a
 *   hit in a slower tier, back-fills the faster tiers so the next read is quick.
 * - **Write-through**: `set`, `delete`, and `clear` apply to every tier.
 *
 * A typical setup is L1 in-process memory plus L2 Redis: microsecond hits when
 * hot, a shared durable tier when not.
 */
export class TieredAdapter<T = unknown> implements StorageAdapter<T> {
  private readonly tiers: StorageAdapter<T>[]

  constructor(options: TieredAdapterOptions<T>) {
    if (!options.tiers || options.tiers.length === 0) {
      throw new ValidationError('TieredAdapter requires at least one tier')
    }
    this.tiers = options.tiers
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    for (let i = 0; i < this.tiers.length; i++) {
      const entry = await this.tiers[i]!.get(key)
      if (entry && !TTLManager.isExpired(entry)) {
        // Promote into the faster tiers that missed.
        for (let j = 0; j < i; j++) {
          await this.tiers[j]!.set(key, entry)
        }
        return entry
      }
    }
    return null
  }

  async set(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    await Promise.all(this.tiers.map((tier) => tier.set(key, entry, ttl)))
  }

  async delete(key: string): Promise<void> {
    await Promise.all(this.tiers.map((tier) => tier.delete(key)))
  }

  async clear(): Promise<void> {
    await Promise.all(this.tiers.map((tier) => tier.clear()))
  }

  async has(key: string): Promise<boolean> {
    for (const tier of this.tiers) {
      if (await tier.has(key)) return true
    }
    return false
  }

  /**
   * Aggregate stats across tiers. `entryCount` is the max across tiers (the most
   * complete tier, since writes are mirrored); `sizeBytes` and `evictions` are
   * summed across the tiers that report them.
   */
  async stats(): Promise<AdapterStats> {
    const all = await Promise.all(this.tiers.map((tier) => tier.stats()))
    let entryCount = 0
    let sizeBytes: number | undefined
    let evictions: number | undefined
    for (const s of all) {
      entryCount = Math.max(entryCount, s.entryCount)
      if (s.sizeBytes !== undefined) sizeBytes = (sizeBytes ?? 0) + s.sizeBytes
      if (s.evictions !== undefined) evictions = (evictions ?? 0) + s.evictions
    }
    return { entryCount, sizeBytes, evictions }
  }
}
