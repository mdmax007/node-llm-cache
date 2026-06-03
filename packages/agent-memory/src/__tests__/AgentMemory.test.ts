import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentMemory } from '../AgentMemory.js'
import { MemoryAdapter } from '@nodellmcache/memory'
import type { MetricEvent } from '@nodellmcache/core'

describe('AgentMemory', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = new AgentMemory({ adapter: new MemoryAdapter() })
  })

  // --- architecture spec ---------------------------------------------------

  it('stores and retrieves a memory item', async () => {
    await memory.store('agent-1', { type: 'semantic', content: 'User likes dark mode', importance: 0.8 })
    const items = await memory.recall('agent-1', 'dark mode')
    expect(items).toHaveLength(1)
    expect(items[0]?.content).toBe('User likes dark mode')
  })

  it('isolates memories per agent', async () => {
    await memory.store('agent-1', { type: 'semantic', content: 'agent 1 fact', importance: 1 })
    await memory.store('agent-2', { type: 'semantic', content: 'agent 2 fact', importance: 1 })
    const agent1 = await memory.recall('agent-1', 'fact')
    expect(agent1.length).toBeGreaterThan(0)
    expect(agent1.every((m) => m.content.includes('agent 1'))).toBe(true)
  })

  it('forgets a specific memory', async () => {
    await memory.store('agent-1', { type: 'episodic', content: 'delete me', importance: 0.1 })
    const before = await memory.recall('agent-1', 'delete me')
    expect(before).toHaveLength(1)
    const removed = await memory.forget('agent-1', before[0]!.id)
    expect(removed).toBe(true)
    const after = await memory.recall('agent-1', 'delete me')
    expect(after).toHaveLength(0)
  })

  it('manages working memory independently', async () => {
    await memory.storeWorking('agent-1', { step: 1, task: 'research' })
    const working = await memory.getWorkingMemory<{ step: number; task: string }>('agent-1')
    expect(working?.step).toBe(1)
    await memory.clearWorkingMemory('agent-1')
    expect(await memory.getWorkingMemory('agent-1')).toBeNull()
  })

  // --- additional behavior -------------------------------------------------

  it('forget returns false for an unknown id', async () => {
    expect(await memory.forget('agent-1', 'nope')).toBe(false)
  })

  it('working memory is isolated per agent', async () => {
    await memory.storeWorking('a', { v: 1 })
    await memory.storeWorking('b', { v: 2 })
    expect(await memory.getWorkingMemory('a')).toEqual({ v: 1 })
    expect(await memory.getWorkingMemory('b')).toEqual({ v: 2 })
  })

  it('ranks by relevance, tie-broken by importance', async () => {
    await memory.store('a', { type: 'semantic', content: 'cache invalidation is hard', importance: 0.3 })
    await memory.store('a', { type: 'semantic', content: 'cache invalidation matters most', importance: 0.9 })
    const results = await memory.recall('a', 'cache invalidation')
    // Both match equally on keywords; higher importance wins the tie.
    expect(results[0]?.importance).toBe(0.9)
  })

  it('filters recall by memory type', async () => {
    await memory.store('a', { type: 'episodic', content: 'saw event X', importance: 0.5 })
    await memory.store('a', { type: 'procedural', content: 'how to do event X', importance: 0.5 })
    const proc = await memory.recall('a', 'event', { type: 'procedural' })
    expect(proc).toHaveLength(1)
    expect(proc[0]?.type).toBe('procedural')
  })

  it('honors a recall limit', async () => {
    for (let i = 0; i < 5; i++) {
      await memory.store('a', { type: 'semantic', content: `note about caching ${i}`, importance: 0.5 })
    }
    const results = await memory.recall('a', 'caching', { limit: 2 })
    expect(results).toHaveLength(2)
  })

  it('defaults importance to 0.5', async () => {
    const item = await memory.store('a', { type: 'semantic', content: 'x' })
    expect(item.importance).toBe(0.5)
  })

  it('preserves metadata', async () => {
    await memory.store('a', { type: 'episodic', content: 'event', importance: 0.5, metadata: { ts: 123 } })
    const [item] = await memory.recall('a', 'event')
    expect(item?.metadata).toEqual({ ts: 123 })
  })

  // --- semantic recall with an embeddingFn ---------------------------------

  it('ranks by cosine similarity when an embeddingFn is provided', async () => {
    const vectors: Record<string, number[]> = {
      'user prefers concise answers': [1, 0],
      'the weather is sunny today': [0, 1],
      'formatting preferences': [0.96, 0.28], // close to the "concise answers" memory
    }
    const embeddingFn = vi.fn((t: string) => Promise.resolve(vectors[t] ?? [0, 0]))
    memory = new AgentMemory({ adapter: new MemoryAdapter(), embeddingFn })

    await memory.store('a', { type: 'semantic', content: 'user prefers concise answers', importance: 0.5 })
    await memory.store('a', { type: 'episodic', content: 'the weather is sunny today', importance: 0.9 })

    const results = await memory.recall('a', 'formatting preferences')
    // Semantically closest wins despite lower importance — keyword overlap would miss entirely.
    expect(results[0]?.content).toBe('user prefers concise answers')
  })

  // --- summarize -----------------------------------------------------------

  it('summarizes memories with a built-in digest', async () => {
    await memory.store('a', { type: 'semantic', content: 'likes dark mode', importance: 0.9 })
    await memory.store('a', { type: 'episodic', content: 'asked about k8s', importance: 0.4 })
    const summary = await memory.summarize('a')
    expect(summary).toContain('likes dark mode')
    expect(summary).toContain('semantic')
    expect(summary).toContain('episodic')
  })

  it('summarize reports when there are no memories', async () => {
    expect(await memory.summarize('empty')).toContain('no stored memories')
  })

  it('summarize delegates to a custom summarizer', async () => {
    await memory.store('a', { type: 'semantic', content: 'x', importance: 0.5 })
    const summary = await memory.summarize('a', async (mems) => `count=${mems.length}`)
    expect(summary).toBe('count=1')
  })

  // --- persistence & lifecycle --------------------------------------------

  it('persists across instances sharing an adapter', async () => {
    const adapter = new MemoryAdapter()
    const m1 = new AgentMemory({ adapter })
    await m1.store('a', { type: 'semantic', content: 'durable fact', importance: 0.7 })
    // Simulate a restart: new instance, same backing store.
    const m2 = new AgentMemory({ adapter })
    const recalled = await m2.recall('a', 'durable fact')
    expect(recalled[0]?.content).toBe('durable fact')
  })

  it('clear() removes long-term and working memory', async () => {
    await memory.store('a', { type: 'semantic', content: 'fact', importance: 0.5 })
    await memory.storeWorking('a', { step: 1 })
    await memory.clear('a')
    expect(await memory.recall('a', 'fact')).toHaveLength(0)
    expect(await memory.getWorkingMemory('a')).toBeNull()
  })

  // --- metrics -------------------------------------------------------------

  it('emits metrics for store and recall', async () => {
    const events: MetricEvent[] = []
    memory = new AgentMemory({ adapter: new MemoryAdapter(), metrics: { emit: (e) => events.push(e) } })
    await memory.store('a', { type: 'semantic', content: 'hi', importance: 0.5 })
    await memory.recall('a', 'hi') // hit
    await memory.recall('a', 'zzz nonexistent') // still returns ranked items (hit) unless empty
    await memory.recall('empty-agent', 'q') // miss (no memories)
    expect(events).toContain('cache.set')
    expect(events).toContain('cache.hit')
    expect(events).toContain('cache.miss')
  })
})
