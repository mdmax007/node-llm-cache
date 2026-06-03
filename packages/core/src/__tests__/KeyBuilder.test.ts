import { describe, it, expect } from 'vitest'
import { KeyBuilder } from '../KeyBuilder.js'

describe('KeyBuilder', () => {
  it('builds a namespaced key', () => {
    const key = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world')
    expect(key).toMatch(/^prompt:openai:gpt-4o:[a-f0-9]{64}$/)
  })

  it('normalizes whitespace before hashing', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello   world')
    const key2 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world')
    expect(key1).toBe(key2)
  })

  it('normalizes casing before hashing', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'Hello World')
    const key2 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world')
    expect(key1).toBe(key2)
  })

  it('trims surrounding whitespace', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', '  hello world  ')
    const key2 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello world')
    expect(key1).toBe(key2)
  })

  it('produces different keys for different models', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello')
    const key2 = KeyBuilder.build('prompt', 'openai', 'gpt-3.5-turbo', 'hello')
    expect(key1).not.toBe(key2)
  })

  it('produces different keys for different providers', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello')
    const key2 = KeyBuilder.build('prompt', 'anthropic', 'gpt-4o', 'hello')
    expect(key1).not.toBe(key2)
  })

  it('produces different keys for different cache types', () => {
    const key1 = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'hello')
    const key2 = KeyBuilder.build('embedding', 'openai', 'gpt-4o', 'hello')
    expect(key1).not.toBe(key2)
  })

  it('never embeds raw text in the key', () => {
    const key = KeyBuilder.build('prompt', 'openai', 'gpt-4o', 'secret prompt content')
    expect(key).not.toContain('secret')
  })

  describe('normalize', () => {
    it('trims, lowercases, and collapses whitespace', () => {
      expect(KeyBuilder.normalize('  Hello\t\n  World  ')).toBe('hello world')
    })
  })

  describe('hash', () => {
    it('returns a 64-char hex sha256 digest', () => {
      expect(KeyBuilder.hash('hello')).toMatch(/^[a-f0-9]{64}$/)
    })

    it('is deterministic', () => {
      expect(KeyBuilder.hash('hello')).toBe(KeyBuilder.hash('hello'))
    })
  })
})
