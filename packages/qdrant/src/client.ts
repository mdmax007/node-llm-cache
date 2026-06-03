import { QdrantClient as RealQdrantClient } from '@qdrant/js-client-rest'
import type { QdrantClient } from './QdrantClient.js'

/** Connection options for the Qdrant REST client. */
export interface QdrantConnectionOptions {
  /** Full URL, e.g. `http://localhost:6333`. */
  url?: string
  host?: string
  port?: number
  /** API key for Qdrant Cloud / secured instances. */
  apiKey?: string
  /** Request timeout (ms). */
  timeout?: number
}

/**
 * Constructs a real `@qdrant/js-client-rest` client. Excluded from unit coverage
 * (it opens real connections); exercised by the Docker-guarded integration suite.
 */
export function createQdrantClient(options: QdrantConnectionOptions): QdrantClient {
  const client = options.url
    ? new RealQdrantClient({ url: options.url, apiKey: options.apiKey, timeout: options.timeout })
    : new RealQdrantClient({
        host: options.host ?? 'localhost',
        port: options.port ?? 6333,
        apiKey: options.apiKey,
        timeout: options.timeout,
      })
  return client as unknown as QdrantClient
}
