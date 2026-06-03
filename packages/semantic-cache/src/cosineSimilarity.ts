import { ValidationError } from '@nodellmcache/core'

/**
 * Pure-JS cosine similarity of two equal-length vectors, in the range
 * `[-1, 1]`. Returns `0` if either vector is all zeros (undefined direction).
 *
 * @throws {ValidationError} if the vectors have different lengths.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(`Vector length mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
