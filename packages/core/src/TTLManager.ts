import type { CacheEntry } from './interfaces.js'

/**
 * Centralizes time-to-live arithmetic: computing expiry timestamps, checking
 * expiry, and supporting sliding-window refresh. All durations are relative
 * milliseconds; all timestamps are absolute epoch milliseconds.
 */
export class TTLManager {
  /**
   * Computes the absolute expiry timestamp for an entry created at `createdAt`
   * with a relative `ttl`. Returns `undefined` when `ttl` is not a positive
   * number, meaning the entry never expires.
   */
  static computeExpiresAt(createdAt: number, ttl?: number): number | undefined {
    if (ttl === undefined || ttl <= 0) return undefined
    return createdAt + ttl
  }

  /**
   * Returns true when the entry has an expiry and that expiry is at or before
   * `now` (defaults to the current time).
   */
  static isExpired(entry: Pick<CacheEntry<unknown>, 'expiresAt'>, now: number = Date.now()): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= now
  }

  /**
   * Milliseconds remaining until the entry expires. Returns `Infinity` for
   * entries with no expiry, and `0` for already-expired entries.
   */
  static remaining(entry: Pick<CacheEntry<unknown>, 'expiresAt'>, now: number = Date.now()): number {
    if (entry.expiresAt === undefined) return Infinity
    return Math.max(0, entry.expiresAt - now)
  }

  /**
   * Computes a refreshed expiry for a sliding-window TTL: extends the entry's
   * life by `ttl` from `now`. Returns `undefined` when `ttl` is not positive.
   */
  static slide(ttl?: number, now: number = Date.now()): number | undefined {
    return TTLManager.computeExpiresAt(now, ttl)
  }
}
