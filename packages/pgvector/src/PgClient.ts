/**
 * Minimal Postgres client surface {@link PgVectorAdapter} depends on. The real
 * `pg` `Pool`/`Client` satisfies this; tests inject an in-memory fake.
 */
export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
  end(): Promise<void>
}
