export interface RateLimiter {
  /** 窗口内第 n 次调用；超限返回 allowed=false 和需要等待的秒数。 */
  hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }>;
}

export class MemoryRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSec: number) {
    const now = Date.now();
    let bucket = this.#buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSec * 1000 };
      this.#buckets.set(key, bucket);
      if (this.#buckets.size > 10_000) this.#sweep(now);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  #sweep(now: number) {
    for (const [key, bucket] of this.#buckets) if (bucket.resetAt <= now) this.#buckets.delete(key);
  }
}

/** ioredis 里用到的最小子集。 */
export interface RedisCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

export class RedisRateLimiter implements RateLimiter {
  readonly #redis: RedisCounter;
  readonly #fallback = new MemoryRateLimiter();

  constructor(redis: RedisCounter) {
    this.#redis = redis;
  }

  async hit(key: string, limit: number, windowSec: number) {
    try {
      const redisKey = `rl:${key}`;
      const count = await this.#redis.incr(redisKey);
      if (count === 1) await this.#redis.expire(redisKey, windowSec);
      const ttl = await this.#redis.ttl(redisKey);
      if (ttl < 0) await this.#redis.expire(redisKey, windowSec);
      return { allowed: count <= limit, retryAfterSec: Math.max(1, ttl > 0 ? ttl : windowSec) };
    } catch {
      return this.#fallback.hit(key, limit, windowSec);
    }
  }
}

export async function createRedisRateLimiter(
  url: string,
): Promise<{ limiter: RedisRateLimiter; close(): void }> {
  const { Redis } = await import("ioredis");
  const redis = new Redis(url);
  redis.on("error", () => {});
  return { limiter: new RedisRateLimiter(redis), close: () => redis.disconnect() };
}
