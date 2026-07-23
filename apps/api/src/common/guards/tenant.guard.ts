import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skipTenantCheck = this.reflector.getAllAndOverride<boolean>('skipTenantCheck', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipTenantCheck) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    let req: { tenantId?: string; user?: { userType?: string } };

    if (context.getType() === 'http') {
      req = context.switchToHttp().getRequest();
    } else {
      const gqlCtx = GqlExecutionContext.create(context);
      req = gqlCtx.getContext().req;
    }

    // Super admins can operate without tenant context
    if (req.user?.userType === 'SUPER_ADMIN') return true;

    if (!req.tenantId) {
      this.logger.warn('Request missing tenant context');
      throw new UnauthorizedException('Tenant context required. Provide X-Tenant-ID header or use a tenant subdomain.');
    }

    // Verify user belongs to tenant
    const user = req.user as { tenantId?: string; userType?: string } | undefined;
    if (user && user.tenantId && user.tenantId !== req.tenantId) {
      this.logger.warn(`User tenant ${user.tenantId} does not match request tenant ${req.tenantId}`);
      throw new ForbiddenException('Access denied: tenant mismatch');
    }

    return true;
  }
}
