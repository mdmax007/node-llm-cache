import { randomUUID } from 'node:crypto'
import { KeyBuilder } from '@nodellmcache/core'
import type { CacheEntry, MetricsSink, StorageAdapter } from '@nodellmcache/core'
import { cosineSimilarity } from '@nodellmcache/semantic-cache'

/** Long-term memory categories. `working` is transient scratch state (handled separately). */
export type MemoryType = 'episodic' | 'semantic' | 'procedural'

/** Input when storing a long-term memory. */
export interface MemoryInput {
  type: MemoryType
  content: string
  /** 0..1 salience; influences recall ranking. Default 0.5. */
  importance?: number
  metadata?: Record<string, unknown>
}

/** A stored memory item. */
export interface MemoryItem extends MemoryInput {
  id: string
  agentId: string
  importance: number
  createdAt: number
  /** Present when an `embeddingFn` was configured at store time. */
  embedding?: number[]
}

export interface RecallOptions {
  /** Max items to return. Default 10. */
  limit?: number
  /** Minimum relevance score (0..1) to include. Default 0 (rank-only). */
  minScore?: number
  /** Restrict to a memory type. */
  type?: MemoryType
}

export interface AgentMemoryOptions {
  /** Storage backend (injected). Use a persistent adapter (e.g. Redis) to survive restarts. */
  adapter: StorageAdapter<unknown>
  /** Optional embedder; when provided, recall ranks by cosine similarity instead of keyword overlap. */
  embeddingFn?: (text: string) => Promise<number[]>
  /** Key prefix. Default `'agent:'`. */
  namespace?: string
  /** Metrics sink; recall emits hit/miss, store/working emit set. */
  metrics?: MetricsSink
}

const noopMetrics: MetricsSink = { emit() {} }

/**
 * Persistent, per-agent memory store. Holds long-term memories (episodic,
 * semantic, procedural) plus transient working memory, isolated per `agentId`.
 *
 * Memories live in the injected `StorageAdapter` (one record per agent), so a
 * persistent adapter gives memory that survives restarts. Recall ranks by cosine
 * similarity when an `embeddingFn` is configured, otherwise by keyword overlap.
 */
export class AgentMemory {
  private readonly adapter: StorageAdapter<unknown>
  private readonly embeddingFn: ((text: string) => Promise<number[]>) | undefined
  private readonly namespace: string
  private readonly metrics: MetricsSink

  constructor(options: AgentMemoryOptions) {
    this.adapter = options.adapter
    this.embeddingFn = options.embeddingFn
    this.namespace = options.namespace ?? 'agent:'
    this.metrics = options.metrics ?? noopMetrics
  }

  /** Stores a long-term memory for an agent and returns the created item. */
  async store(agentId: string, input: MemoryInput): Promise<MemoryItem> {
    const item: MemoryItem = {
      id: randomUUID(),
      agentId,
      type: input.type,
      content: input.content,
      importance: input.importance ?? 0.5,
      createdAt: Date.now(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }
    if (this.embeddingFn) item.embedding = await this.embeddingFn(input.content)

    const memories = await this.load(agentId)
    memories.push(item)
    await this.save(agentId, memories)
    this.metrics.emit('cache.set', { cacheType: 'agent', latencyMs: 0 })
    return item
  }

  /** Returns the agent's most relevant memories for `query`, ranked. */
  async recall(agentId: string, query: string, options: RecallOptions = {}): Promise<MemoryItem[]> {
    const start = Date.now()
    const limit = options.limit ?? 10
    const minScore = options.minScore ?? 0

    let memories = await this.load(agentId)
    if (options.type) memories = memories.filter((m) => m.type === options.type)

    const queryEmbedding = this.embeddingFn ? await this.embeddingFn(query) : undefined
    const scored = memories.map((item) => ({
      item,
      score: this.relevance(query, queryEmbedding, item),
    }))

    const results = scored
      .filter((s) => s.score >= minScore)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.item.importance - a.item.importance ||
          b.item.createdAt - a.item.createdAt,
      )
      .slice(0, limit)
      .map((s) => s.item)

    this.metrics.emit(results.length > 0 ? 'cache.hit' : 'cache.miss', {
      cacheType: 'agent',
      latencyMs: Date.now() - start,
    })
    return results
  }

  /** Removes a memory by id. Returns true if it existed. */
  async forget(agentId: string, id: string): Promise<boolean> {
    const memories = await this.load(agentId)
    const next = memories.filter((m) => m.id !== id)
    if (next.length === memories.length) return false
    await this.save(agentId, next)
    return true
  }

  /**
   * Produces a digest of an agent's memories. With no `summarizer`, returns a
   * built-in text digest grouped by type and ordered by importance; pass a
   * `summarizer` (e.g. an LLM call) for a richer summary.
   */
  async summarize(
    agentId: string,
    summarizer?: (memories: MemoryItem[]) => Promise<string>,
  ): Promise<string> {
    const memories = await this.load(agentId)
    if (summarizer) return summarizer(memories)
    if (memories.length === 0) return `Agent ${agentId} has no stored memories.`

    const byType = new Map<MemoryType, MemoryItem[]>()
    for (const m of memories) byType.set(m.type, [...(byType.get(m.type) ?? []), m])

    const sections: string[] = [`Memory summary for agent ${agentId}:`]
    for (const [type, items] of byType) {
      sections.push(`\n${type} (${items.length}):`)
      for (const m of [...items].sort((a, b) => b.importance - a.importance)) {
        sections.push(`  - ${m.content} [importance ${m.importance.toFixed(2)}]`)
      }
    }
    return sections.join('\n')
  }

  /** Stores the agent's working (scratch) memory, replacing any previous value. */
  async storeWorking<W>(agentId: string, data: W): Promise<void> {
    await this.adapter.set(this.workingKey(agentId), this.entry(this.workingKey(agentId), data))
    this.metrics.emit('cache.set', { cacheType: 'agent', latencyMs: 0 })
  }

  /** Returns the agent's working memory, or null if none. */
  async getWorkingMemory<W = unknown>(agentId: string): Promise<W | null> {
    const e = await this.adapter.get(this.workingKey(agentId))
    return e ? (e.value as W) : null
  }

  /** Clears the agent's working memory. */
  async clearWorkingMemory(agentId: string): Promise<void> {
    await this.adapter.delete(this.workingKey(agentId))
  }

  /** Removes all of an agent's long-term and working memory. */
  async clear(agentId: string): Promise<void> {
    await this.adapter.delete(this.memoriesKey(agentId))
    await this.adapter.delete(this.workingKey(agentId))
  }

  // --- internals -----------------------------------------------------------

  private relevance(query: string, queryEmbedding: number[] | undefined, item: MemoryItem): number {
    if (queryEmbedding && item.embedding) {
      // Map cosine [-1,1] to [0,1] so it composes with keyword scores.
      return (cosineSimilarity(queryEmbedding, item.embedding) + 1) / 2
    }
    return keywordOverlap(query, item.content)
  }

  private async load(agentId: string): Promise<MemoryItem[]> {
    const e = await this.adapter.get(this.memoriesKey(agentId))
    return e ? (e.value as MemoryItem[]) : []
  }

  private async save(agentId: string, memories: MemoryItem[]): Promise<void> {
    const key = this.memoriesKey(agentId)
    await this.adapter.set(key, this.entry(key, memories))
  }

  private entry<V>(key: string, value: V): CacheEntry<V> {
    return {
      key,
      value,
      createdAt: Date.now(),
      metadata: { compressed: false, originalSize: 0, cacheType: 'agent' },
    }
  }

  private memoriesKey(agentId: string): string {
    return `${this.namespace}${agentId}:memories`
  }

  private workingKey(agentId: string): string {
    return `${this.namespace}${agentId}:working`
  }
}

/** Fraction of normalized query terms that appear in the content (0..1). */
function keywordOverlap(query: string, content: string): number {
  const terms = KeyBuilder.normalize(query).split(' ').filter(Boolean)
  if (terms.length === 0) return 0
  const haystack = KeyBuilder.normalize(content)
  let hits = 0
  for (const term of terms) if (haystack.includes(term)) hits++
  return hits / terms.length
}
