import { SerializationError } from './errors.js'

/**
 * Converts values to and from `Buffer` for storage. Implementations decide the
 * wire format.
 *
 * The architecture calls for MessagePack as the primary format, but
 * `@nodellmcache/core` must stay dependency-free, so it ships only the JSON
 * implementation below. A MessagePack serializer can be supplied by an optional
 * package and injected wherever a `Serializer` is accepted.
 */
export interface Serializer {
  serialize<T>(value: T): Buffer
  deserialize<T>(data: Buffer): T
}

/**
 * Default JSON-backed serializer. Zero dependencies; handles the common case
 * and wraps failures in {@link SerializationError}.
 */
export class JsonSerializer implements Serializer {
  serialize<T>(value: T): Buffer {
    try {
      return Buffer.from(JSON.stringify(value), 'utf8')
    } catch (cause) {
      throw new SerializationError('Failed to serialize value to JSON', { cause })
    }
  }

  deserialize<T>(data: Buffer): T {
    try {
      return JSON.parse(data.toString('utf8')) as T
    } catch (cause) {
      throw new SerializationError('Failed to deserialize JSON value', { cause })
    }
  }
}
