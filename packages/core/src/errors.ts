/**
 * Base class for every error thrown by NodeLLMCache packages. Catching this
 * catches anything the library throws intentionally.
 */
export class NodeLLMCacheError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    // Restore prototype chain for instanceof across the ES5 transpile boundary.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when a storage adapter operation fails. */
export class CacheAdapterError extends NodeLLMCacheError {}

/** Thrown when compression or decompression fails. */
export class CompressionError extends NodeLLMCacheError {}

/** Thrown when serialization or deserialization fails. */
export class SerializationError extends NodeLLMCacheError {}

/** Thrown when a value fails validation (e.g. malformed configuration). */
export class ValidationError extends NodeLLMCacheError {}
