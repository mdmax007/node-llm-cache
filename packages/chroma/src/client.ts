import { ChromaClient as RealChromaClient } from 'chromadb'
import type { ChromaClient } from './ChromaClient.js'

/** Connection options for the Chroma client. */
export interface ChromaConnectionOptions {
  /** Server URL, e.g. `http://localhost:8000`. */
  path?: string
}

/**
 * Constructs a real `chromadb` client. Excluded from unit coverage (opens real
 * connections); exercised by the Docker-guarded integration suite.
 */
export function createChromaClient(options: ChromaConnectionOptions): ChromaClient {
  return new RealChromaClient({ path: options.path ?? 'http://localhost:8000' }) as unknown as ChromaClient
}
