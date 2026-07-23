import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async checkDatabase(): Promise<{ status: string; latency?: number }> {
    const start = Date.now();
    const healthy = await this.prisma.isHealthy();
    return {
      status: healthy ? 'up' : 'down',
      latency: Date.now() - start,
    };
  }

  async checkRedis(): Promise<{ status: string; latency?: number }> {
    const start = Date.now();
    const healthy = await this.redis.isHealthy();
    return {
      status: healthy ? 'up' : 'down',
      latency: Date.now() - start,
    };
  }
}
