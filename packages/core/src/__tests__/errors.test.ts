import { describe, it, expect } from 'vitest'
import {
  NodeLLMCacheError,
  CacheAdapterError,
  CompressionError,
  SerializationError,
  ValidationError,
} from '../errors.js'

describe('error hierarchy', () => {
  const subclasses = [
    CacheAdapterError,
    CompressionError,
    SerializationError,
    ValidationError,
  ]

  it('all subclasses extend NodeLLMCacheError', () => {
    for (const E of subclasses) {
      const err = new E('boom')
      expect(err).toBeInstanceOf(NodeLLMCacheError)
      expect(err).toBeInstanceOf(Error)
    }
  })

  it('sets name to the concrete class name', () => {
    expect(new CacheAdapterError('x').name).toBe('CacheAdapterError')
    expect(new NodeLLMCacheError('x').name).toBe('NodeLLMCacheError')
  })

  it('preserves the message', () => {
    expect(new ValidationError('bad config').message).toBe('bad config')
  })

  it('supports an error cause', () => {
    const cause = new Error('underlying')
    expect(new CompressionError('wrapper', { cause }).cause).toBe(cause)
  })

  it('instanceof works for the specific subclass', () => {
    const err = new SerializationError('x')
    expect(err instanceof SerializationError).toBe(true)
    expect(err instanceof CompressionError).toBe(false)
  })
})
