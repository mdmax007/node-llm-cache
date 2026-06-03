import pg from 'pg'
import type { PgClient } from './PgClient.js'

/** Connection options for the Postgres pool. */
export interface PgConnectionOptions {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
  max?: number
}

/**
 * Constructs a `pg` connection pool. Excluded from unit coverage (opens real
 * connections); exercised by the Docker-guarded integration suite.
 */
export function createPgPool(options: PgConnectionOptions): PgClient {
  const { Pool } = pg
  const pool = options.connectionString
    ? new Pool({ connectionString: options.connectionString, ssl: options.ssl, max: options.max })
    : new Pool({
        host: options.host ?? 'localhost',
        port: options.port ?? 5432,
        user: options.user,
        password: options.password,
        database: options.database,
        ssl: options.ssl,
        max: options.max,
      })
  return pool as unknown as PgClient
}
