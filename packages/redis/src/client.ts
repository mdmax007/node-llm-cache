import { Redis, Cluster } from 'ioredis'
import type { RedisClient } from './RedisClient.js'

/** Connection options for constructing an `ioredis` client. */
export interface RedisConnectionOptions {
  /** Full connection URL, e.g. `redis://:pass@host:6379/0`. Takes precedence. */
  url?: string
  host?: string
  port?: number
  password?: string
  db?: number
  /** Redis Sentinel endpoints; requires `name` (the master group). */
  sentinels?: { host: string; port: number }[]
  /** Sentinel master group name. */
  name?: string
  /** Redis Cluster node endpoints. */
  cluster?: { host: string; port: number }[]
}

/**
 * Builds an `ioredis` client from connection options, supporting standalone,
 * URL, Sentinel, and Cluster modes, with a bounded reconnect strategy.
 *
 * Not covered by unit tests — it opens real connections and is exercised by the
 * Docker-guarded integration suite.
 */
export function createRedisClient(options: RedisConnectionOptions): RedisClient {
  const retryStrategy = (times: number): number | null =>
    times > 10 ? null : Math.min(times * 200, 2000)

  if (options.cluster && options.cluster.length > 0) {
    return new Cluster(options.cluster, {
      redisOptions: { password: options.password },
    }) as unknown as RedisClient
  }
  if (options.url) {
    return new Redis(options.url, { retryStrategy }) as unknown as RedisClient
  }
  if (options.sentinels && options.sentinels.length > 0) {
    return new Redis({
      sentinels: options.sentinels,
      name: options.name,
      password: options.password,
      db: options.db,
      retryStrategy,
    }) as unknown as RedisClient
  }
  return new Redis({
    host: options.host ?? 'localhost',
    port: options.port ?? 6379,
    password: options.password,
    db: options.db,
    retryStrategy,
  }) as unknown as RedisClient
}
