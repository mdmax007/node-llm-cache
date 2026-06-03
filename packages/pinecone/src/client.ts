import { Pinecone } from '@pinecone-database/pinecone'
import type { PineconeIndex } from './PineconeClient.js'

/** Connection options for Pinecone. */
export interface PineconeConnectionOptions {
  apiKey?: string
  /** Target index name (must already exist). */
  index: string
  /** Optional namespace within the index. */
  namespace?: string
}

/**
 * Resolves a Pinecone index handle. Excluded from unit coverage (it talks to the
 * hosted service); exercised by the credential-guarded integration suite.
 */
export function createPineconeIndex(options: PineconeConnectionOptions): PineconeIndex {
  const pc = new Pinecone(options.apiKey ? { apiKey: options.apiKey } : undefined)
  const index = pc.index(options.index)
  const handle = options.namespace ? index.namespace(options.namespace) : index
  return handle as unknown as PineconeIndex
}
