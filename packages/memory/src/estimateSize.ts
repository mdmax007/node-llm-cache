/**
 * Cheaply estimates the in-memory byte footprint of a value for LRU budgeting.
 *
 * This is an approximation, not an exact heap measurement — it is good enough
 * to keep the cache under a configured `maxSize`. Binary types report their
 * real byte length; objects fall back to their JSON length.
 */
export function estimateSize(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (Buffer.isBuffer(value)) return value.length
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  switch (typeof value) {
    case 'string':
      return Buffer.byteLength(value)
    case 'number':
    case 'bigint':
      return 8
    case 'boolean':
      return 4
    default:
      try {
        const json = JSON.stringify(value)
        return json === undefined ? 0 : Buffer.byteLength(json)
      } catch {
        // Circular or otherwise non-serializable — treat as negligible.
        return 0
      }
  }
}
