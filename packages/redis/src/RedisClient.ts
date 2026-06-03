/**
 * The minimal Redis command surface that {@link RedisAdapter} depends on. Real
 * `ioredis` clients satisfy this; tests inject an in-memory fake. Keeping the
 * dependency to an interface (not the concrete class) makes the adapter fully
 * unit-testable without a live Redis.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>
  del(...keys: string[]): Promise<number>
  exists(key: string): Promise<number>
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>
  info(): Promise<string>
  ping(): Promise<string>
  quit(): Promise<unknown>
}
