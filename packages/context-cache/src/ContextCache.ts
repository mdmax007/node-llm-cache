import { BaseCacheManager } from '@nodellmcache/core'
import type { BaseCacheManagerOptions, CacheOptions, CacheType } from '@nodellmcache/core'

/**
 * A reference to a document that contributes to an assembled context. A bare
 * string is treated as the id; the object form lets a `version` (or hash) bust
 * the cache when the underlying document changes.
 */
export type ContextDocumentRef = string | { id: string; version?: string | number }

export type ContextCacheOptions<T> = BaseCacheManagerOptions<T>

/**
 * Caches assembled context windows — the (often expensive) result of selecting,
 * ordering, trimming, and formatting retrieved documents for a prompt.
 *
 * The cache key is the query plus an order-independent fingerprint of the
 * contributing documents (id + optional version), so the same query over the
 * same document set + versions hits, while any change busts it.
 */
export class ContextCache<T = string> extends BaseCacheManager<T> {
  protected readonly cacheType: CacheType = 'context'

  constructor(options: ContextCacheOptions<T>) {
    super(options)
  }

  /**
   * Returns the assembled context for `query` over `documents`, building and
   * caching it on a miss.
   */
  async getOrAssemble(
    query: string,
    documents: ReadonlyArray<ContextDocumentRef>,
    generator: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    const key = `${query} ${this.fingerprint(documents)}`
    return this.getOrGenerate(key, generator, options)
  }

  /** Invalidates the assembled context for a specific query + document set. */
  async invalidateAssembled(
    query: string,
    documents: ReadonlyArray<ContextDocumentRef>,
    options?: CacheOptions,
  ): Promise<void> {
    await this.invalidate(`${query} ${this.fingerprint(documents)}`, options)
  }

  /** Order-independent fingerprint of the contributing documents (id[@version]). */
  private fingerprint(documents: ReadonlyArray<ContextDocumentRef>): string {
    return documents
      .map((doc) => (typeof doc === 'string' ? doc : doc.version === undefined ? doc.id : `${doc.id}@${doc.version}`))
      .sort()
      .join('|')
  }
}
