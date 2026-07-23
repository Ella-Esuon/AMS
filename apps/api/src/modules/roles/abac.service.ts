import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

export interface AbacContext {
  userId: string;
  tenantId: string;
  userType: string;
  roles: string[];
  departmentId?: string | null;
  resource: string;
  action: string;
  resourceOwnerId?: string;
  resourceTenantId?: string;
  ipAddress?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface PolicyConditions {
  timeRange?: { start: string; end: string; timezone?: string };
  ipRange?: string[];
  departments?: string[];
  ownResourceOnly?: boolean;
  maxAmount?: number;
  daysOfWeek?: number[];
  roles?: string[];
}

interface EvaluatedPolicy {
  name: string;
  effect: 'ALLOW' | 'DENY';
  priority: number;
  matches: boolean;
}

@Injectable()
export class AbacService {
  private readonly logger = new Logger(AbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── Policy Evaluation ────────────────────────────────────────────────────

  async evaluate(ctx: AbacContext): Promise<boolean> {
    const cacheKey = this.redis.buildTenantKey(
      ctx.tenantId,
      'abac',
      ctx.userId,
      ctx.resource,
      ctx.action,
    );

    // Load policies: user-specific + tenant-wide
    const policies = await this.prisma.userPolicy.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        OR: [{ userId: ctx.userId }, { userId: null }],
        expiresAt: { or: [{ gt: new Date() }, { equals: null }] } as never,
      },
      orderBy: [{ priority: 'desc' }, { effect: 'asc' }],
    });

    const evaluated: EvaluatedPolicy[] = [];

    for (const policy of policies) {
      const matchesResource = this.matchesPattern(ctx.resource, policy.resources);
      const matchesAction = this.matchesPattern(ctx.action, policy.actions);

      if (!matchesResource || !matchesAction) continue;

      const conditionsMet = this.evaluateConditions(
        policy.conditions as PolicyConditions | null,
        ctx,
      );

      evaluated.push({
        name: policy.name,
        effect: policy.effect as 'ALLOW' | 'DENY',
        priority: policy.priority,
        matches: conditionsMet,
      });
    }

    const matchedPolicies = evaluated.filter((p) => p.matches);

    if (matchedPolicies.length === 0) {
      // No matching policies — default deny (secure by default)
      return false;
    }

    // Deny takes precedence over allow (at same priority)
    const highestPriority = Math.max(...matchedPolicies.map((p) => p.priority));
    const topPolicies = matchedPolicies.filter((p) => p.priority === highestPriority);

    // If any top-priority policy denies, deny
    if (topPolicies.some((p) => p.effect === 'DENY')) return false;

    // If all top-priority policies allow, allow
    return topPolicies.some((p) => p.effect === 'ALLOW');
  }

  // ─── Permission Check (RBAC + ABAC combined) ──────────────────────────────

  async can(ctx: AbacContext, requiredPermission: string): Promise<boolean> {
    const [resource, action] = requiredPermission.split(':');

    // 1. Super admins have full access
    if (ctx.roles.includes('super_admin') || ctx.userType === 'SUPER_ADMIN') {
      return true;
    }

    // 2. Check ABAC policies (if any exist for this user/tenant)
    const hasAbacPolicies = await this.prisma.userPolicy.count({
      where: { tenantId: ctx.tenantId, isActive: true },
    });

    if (hasAbacPolicies > 0) {
      return this.evaluate({ ...ctx, resource, action });
    }

    // 3. Fall back to RBAC only
    return true; // RBAC already checked via guard
  }

  // ─── Condition Evaluation ─────────────────────────────────────────────────

  private evaluateConditions(
    conditions: PolicyConditions | null | undefined,
    ctx: AbacContext,
  ): boolean {
    if (!conditions || Object.keys(conditions).length === 0) return true;

    const timestamp = ctx.timestamp || new Date();

    // Time range check
    if (conditions.timeRange) {
      if (!this.isInTimeRange(timestamp, conditions.timeRange)) {
        this.logger.debug(`Policy rejected: outside time range`);
        return false;
      }
    }

    // Day of week check
    if (conditions.daysOfWeek && conditions.daysOfWeek.length > 0) {
      if (!conditions.daysOfWeek.includes(timestamp.getDay())) {
        this.logger.debug(`Policy rejected: wrong day of week`);
        return false;
      }
    }

    // IP range check
    if (conditions.ipRange && conditions.ipRange.length > 0 && ctx.ipAddress) {
      if (!this.isInIpRange(ctx.ipAddress, conditions.ipRange)) {
        this.logger.debug(`Policy rejected: IP not in range`);
        return false;
      }
    }

    // Department restriction
    if (conditions.departments && conditions.departments.length > 0) {
      if (!ctx.departmentId || !conditions.departments.includes(ctx.departmentId)) {
        this.logger.debug(`Policy rejected: department not in list`);
        return false;
      }
    }

    // Own resource only
    if (conditions.ownResourceOnly === true) {
      if (ctx.resourceOwnerId !== ctx.userId) {
        this.logger.debug(`Policy rejected: not own resource`);
        return false;
      }
    }

    // Role restriction
    if (conditions.roles && conditions.roles.length > 0) {
      const hasRole = conditions.roles.some((r) => ctx.roles.includes(r));
      if (!hasRole) return false;
    }

    return true;
  }

  private isInTimeRange(
    timestamp: Date,
    range: { start: string; end: string; timezone?: string },
  ): boolean {
    const hours = timestamp.getHours();
    const minutes = timestamp.getMinutes();
    const current = hours * 60 + minutes;

    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;

    if (start <= end) {
      return current >= start && current <= end;
    }
    // Overnight range (e.g., 22:00 - 06:00)
    return current >= start || current <= end;
  }

  private isInIpRange(ip: string, ranges: string[]): boolean {
    return ranges.some((range) => {
      if (range.includes('/')) {
        // CIDR notation — simple prefix check (not full CIDR implementation)
        const [prefix] = range.split('/');
        return ip.startsWith(prefix.split('.').slice(0, 3).join('.'));
      }
      return ip === range;
    });
  }

  private matchesPattern(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern === value) return true;
      if (pattern.endsWith('*')) {
        return value.startsWith(pattern.slice(0, -1));
      }
      return false;
    });
  }
}
