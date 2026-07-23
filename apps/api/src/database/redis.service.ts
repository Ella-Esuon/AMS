import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;

  constructor(private readonly config: ConfigService) {
    this.keyPrefix = config.get<string>('redis.keyPrefix', 'ams:');
    this.defaultTtl = config.get<number>('redis.ttl', 3600);

    this.client = new Redis({
      host: config.get<string>('redis.host', 'localhost'),
      port: config.get<number>('redis.port', 6379),
      password: config.get<string>('redis.password') || undefined,
      db: config.get<number>('redis.db', 0),
      keyPrefix: this.keyPrefix,
      retryStrategy: (times) => {
        if (times > 10) {
          this.logger.error('Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (err) => this.logger.error('Redis error:', err.message));
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting...'));
    this.client.on('close', () => this.logger.warn('Redis connection closed'));
  }

  async onModuleInit() {
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  // ─── Core Operations ──────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTtl;
    await this.client.setex(key, ttl, serialized);
  }

  async setNx<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTtl;
    const result = await this.client.set(key, serialized, 'EX', ttl, 'NX');
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async exists(...keys: string[]): Promise<boolean> {
    const count = await this.client.exists(...keys);
    return count > 0;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(`${this.keyPrefix}${pattern}`);
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const keys = await this.client.keys(`${this.keyPrefix}${pattern}`);
    if (keys.length === 0) return 0;
    // Strip prefix since ioredis adds it automatically
    const stripped = keys.map((k) => k.replace(this.keyPrefix, ''));
    return this.client.del(...stripped);
  }

  // ─── Hash Operations ──────────────────────────────────────────────────────

  async hset(key: string, field: string, value: unknown): Promise<number> {
    return this.client.hset(key, field, JSON.stringify(value));
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hget(key, field);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async hgetall<T extends Record<string, unknown>>(key: string): Promise<T | null> {
    const data = await this.client.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;
    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    }
    return parsed as T;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  // ─── Counter Operations ───────────────────────────────────────────────────

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.client.incrby(key, increment);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // ─── List Operations ──────────────────────────────────────────────────────

  async rpush<T>(key: string, ...values: T[]): Promise<number> {
    return this.client.rpush(key, ...values.map((v) => JSON.stringify(v)));
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const values = await this.client.lrange(key, start, stop);
    return values.map((v) => {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    });
  }

  // ─── Pub/Sub (lightweight) ────────────────────────────────────────────────

  async publish(channel: string, message: unknown): Promise<number> {
    return this.client.publish(channel, JSON.stringify(message));
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  buildKey(...parts: string[]): string {
    return parts.join(':');
  }

  buildTenantKey(tenantId: string, ...parts: string[]): string {
    return `tenant:${tenantId}:${parts.join(':')}`;
  }
}
