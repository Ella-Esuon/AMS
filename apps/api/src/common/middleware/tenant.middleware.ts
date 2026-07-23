import { Injectable, NestMiddleware, UnauthorizedException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { RequestWithTenant, TenantContext } from '../types/request.types';
import { v4 as uuidv4 } from 'uuid';

const TENANT_CACHE_TTL = 300; // 5 minutes
const TENANT_CACHE_PREFIX = 'tenant:context:';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async use(req: RequestWithTenant, res: Response, next: NextFunction) {
    req.requestId = (req.headers['x-request-id'] as string) || uuidv4();
    req.startTime = Date.now();

    const tenantIdentifier = this.extractTenantIdentifier(req);

    if (!tenantIdentifier) {
      return next();
    }

    try {
      const tenant = await this.resolveTenant(tenantIdentifier);
      if (!tenant) {
        throw new UnauthorizedException(`Tenant not found: ${tenantIdentifier}`);
      }

      if (tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
        throw new UnauthorizedException(
          `Tenant account is ${tenant.status.toLowerCase()}. Please contact support.`,
        );
      }

      req.tenantId = tenant.id;
      req.tenant = tenant;

      this.logger.debug(`Tenant resolved: ${tenant.slug} (${tenant.id})`);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(`Failed to resolve tenant "${tenantIdentifier}": ${(err as Error).message}`);
      throw new UnauthorizedException('Unable to resolve tenant context');
    }

    // Run the rest of the request (guards, controller, services) inside a
    // transaction with app.current_tenant_id set on its connection, so
    // Postgres RLS actually enforces tenant isolation (not just the app-layer
    // Prisma middleware backstop). PrismaService's proxy routes every
    // this.prisma.<model>... call made during this request to that
    // transaction's client without services needing to thread tenantId
    // through manually.
    try {
      await this.prisma.runRequestInTenantScope(
        req.tenantId,
        false,
        () =>
          new Promise<void>((resolve, reject) => {
            res.once('finish', resolve);
            res.once('close', resolve);
            try {
              next();
            } catch (err) {
              reject(err as Error);
            }
          }),
      );
    } catch (err) {
      if (!res.headersSent) {
        next(err as Error);
      } else {
        this.logger.error(`Tenant-scoped request transaction failed: ${(err as Error).message}`);
      }
    }
  }

  private extractTenantIdentifier(req: Request): string | null {
    // 1. X-Tenant-ID header (explicit)
    const headerTenantId = req.headers['x-tenant-id'] as string;
    if (headerTenantId) return headerTenantId;

    // 2. Subdomain (tenant.ams.io)
    const host = req.headers.host || '';
    const subdomain = this.extractSubdomain(host);
    if (subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'app') {
      return subdomain;
    }

    // 3. Query param (for dev/testing only)
    if (process.env.NODE_ENV !== 'production') {
      const queryTenantId = req.query['tenantId'] as string;
      if (queryTenantId) return queryTenantId;
    }

    return null;
  }

  private extractSubdomain(host: string): string | null {
    const parts = host.split('.');
    if (parts.length >= 3) {
      return parts[0];
    }
    return null;
  }

  private async resolveTenant(identifier: string): Promise<TenantContext | null> {
    const cacheKey = `${TENANT_CACHE_PREFIX}${identifier}`;

    // Try cache first
    const cached = await this.redis.get<TenantContext>(cacheKey);
    if (cached) return cached;

    // Query database (by slug, domain, or UUID)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    const tenant = await this.prisma.tenant.findFirst({
      where: {
        OR: [
          isUuid ? { id: identifier } : {},
          { slug: identifier },
          { domain: identifier },
        ].filter((o) => Object.keys(o).length > 0),
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        plan: true,
        status: true,
        timezone: true,
        features: true,
        settings: true,
      },
    });

    if (!tenant) return null;

    const tenantContext: TenantContext = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      timezone: tenant.timezone,
      features: tenant.features as Record<string, unknown>,
      settings: tenant.settings as Record<string, unknown>,
    };

    // Cache for next requests
    await this.redis.set(cacheKey, tenantContext, TENANT_CACHE_TTL);

    return tenantContext;
  }
}
