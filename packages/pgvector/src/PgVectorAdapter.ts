import { ValidationError } from '@nodellmcache/core'
import type { VectorMatch, VectorStoreAdapter } from '@nodellmcache/core'
import { createPgPool, type PgConnectionOptions } from './client.js'
import type { PgClient } from './PgClient.js'

export interface PgVectorAdapterOptions extends PgConnectionOptions {
  /** Inject an existing client (or a compatible fake) instead of constructing a pool. */
  client?: PgClient
  /** Table name (validated as a safe SQL identifier). Default `nodellmcache_vectors`. */
  table?: string
  /** Vector dimensionality. If omitted, inferred from the first upserted vector. */
  vectorSize?: number
  /** Max attempts per operation on transient failure. Default 3. */
  maxRetries?: number
}

const DEFAULT_TABLE = 'nodellmcache_vectors'
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Postgres + [pgvector](https://github.com/pgvector/pgvector) {@link VectorStoreAdapter}.
 * Stores `(id text, embedding vector, metadata jsonb)` rows and queries by cosine
 * distance (`<=>`), exposing cosine **similarity** as `score`. Plugs into
 * `@nodellmcache/semantic-cache`.
 */
export class PgVectorAdapter<M = Record<string, unknown>> implements VectorStoreAdapter<M> {
  private readonly client: PgClient
  private readonly table: string
  private readonly maxRetries: number
  private vectorSize: number | undefined
  private ensured = false

  constructor(options: PgVectorAdapterOptions = {}) {
    this.table = options.table ?? DEFAULT_TABLE
    if (!IDENTIFIER.test(this.table)) {
      throw new ValidationError(`Invalid table name: ${this.table}`)
    }
    this.client = options.client ?? createPgPool(options)
    this.maxRetries = options.maxRetries ?? 3
    this.vectorSize = options.vectorSize
  }

  async upsert(id: string, vector: number[], metadata?: M): Promise<void> {
    await this.ensureSchema(vector.length)
    await this.retry(() =>
      this.client.query(
        `INSERT INTO ${this.table} (id, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
        [id, toVectorLiteral(vector), JSON.stringify(metadata ?? {})],
      ),
    )
  }

  async query(vector: number[], topK: number, filter?: Partial<M>): Promise<VectorMatch<M>[]> {
    await this.ensureSchema(vector.length)
    const hasFilter = filter !== undefined && Object.keys(filter).length > 0
    const sql = hasFilter
      ? `SELECT id, metadata, 1 - (embedding <=> $1::vector) AS score FROM ${this.table}
         WHERE metadata @> $2::jsonb ORDER BY embedding <=> $1::vector ASC LIMIT $3`
      : `SELECT id, metadata, 1 - (embedding <=> $1::vector) AS score FROM ${this.table}
         ORDER BY embedding <=> $1::vector ASC LIMIT $2`
    const params = hasFilter
      ? [toVectorLiteral(vector), JSON.stringify(filter), topK]
      : [toVectorLiteral(vector), topK]

    const { rows } = await this.retry(() => this.client.query(sql, params))
    return rows.map((row) => ({
      id: String(row.id),
      score: Number(row.score),
      metadata: (row.metadata ?? {}) as M,
    }))
  }

  async delete(id: string): Promise<void> {
    await this.retry(() => this.client.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]))
  }

  /** Closes the underlying pool. */
  async disconnect(): Promise<void> {
    await this.client.end()
  }

  // --- internals -----------------------------------------------------------

  private async ensureSchema(size: number): Promise<void> {
    if (this.ensured) return
    this.vectorSize ??= size
    await this.retry(() => this.client.query('CREATE EXTENSION IF NOT EXISTS vector'))
    await this.retry(() =>
      this.client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
           id text PRIMARY KEY,
           embedding vector(${this.vectorSize ?? size}) NOT NULL,
           metadata jsonb NOT NULL DEFAULT '{}'::jsonb
         )`,
      ),
    )
    this.ensured = true
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }
}

/** Formats a vector as a pgvector literal, e.g. `[1,2,3]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
