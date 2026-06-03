import { createHash } from 'node:crypto'
import type { CacheType, LLMProvider } from './types.js'

/**
 * Builds deterministic, collision-resistant cache keys.
 *
 * Format: `{type}:{provider}:{model}:{sha256-hash}`
 *
 * The raw input text is normalized and hashed with SHA-256 — keys never
 * contain raw prompt text, which keeps sensitive content out of storage keys
 * and logs.
 */
export class KeyBuilder {
  /**
   * Normalizes text before hashing so trivially different inputs collapse to
   * the same key: trims surrounding whitespace, lowercases, and collapses any
   * run of whitespace to a single space.
   */
  static normalize(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  /**
   * Produces the SHA-256 hex digest of the normalized text.
   */
  static hash(text: string): string {
    return createHash('sha256').update(KeyBuilder.normalize(text)).digest('hex')
  }

  /**
   * Builds a fully namespaced cache key.
   *
   * @example
   * KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world')
   * // 'prompt:openai:gpt-4o:b94d27b9...'
   */
  static build(
    type: CacheType,
    provider: LLMProvider | string,
    model: string,
    text: string,
  ): string {
    return `${type}:${provider}:${model}:${KeyBuilder.hash(text)}`
  }
}
