import { describe, it, expect } from 'vitest'
import { JsonSerializer } from '../Serializer.js'
import { SerializationError } from '../errors.js'

describe('JsonSerializer', () => {
  const s = new JsonSerializer()

  it('round-trips an object', () => {
    const value = { a: 1, b: 'two', c: [3, 4], d: { nested: true } }
    const buf = s.serialize(value)
    expect(buf).toBeInstanceOf(Buffer)
    expect(s.deserialize(buf)).toEqual(value)
  })

  it('round-trips primitives and arrays', () => {
    expect(s.deserialize(s.serialize(42))).toBe(42)
    expect(s.deserialize(s.serialize('hello'))).toBe('hello')
    expect(s.deserialize(s.serialize([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it('throws SerializationError on circular references', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => s.serialize(circular)).toThrow(SerializationError)
  })

  it('throws SerializationError on invalid JSON input', () => {
    expect(() => s.deserialize(Buffer.from('{not valid json', 'utf8'))).toThrow(SerializationError)
  })
})
