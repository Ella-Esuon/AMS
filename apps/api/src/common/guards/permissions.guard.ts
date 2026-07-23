import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PERMISSIONS_KEY, PermissionDef } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../types/request.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionDef[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const user = this.getUser(context);
    if (!user) throw new ForbiddenException('Authentication required');

    // Super admin has all permissions
    if (user.roles.includes('super_admin') || user.userType === 'SUPER_ADMIN') {
      return true;
    }

    const hasAllPermissions = requiredPermissions.every((perm) => {
      const permissionKey = `${perm.resource}:${perm.action}`;
      const wildcardKey = `${perm.resource}:*`;
      return (
        user.permissions.includes(permissionKey) ||
        user.permissions.includes(wildcardKey) ||
        user.permissions.includes('*:*')
      );
    });

    if (!hasAllPermissions) {
      this.logger.warn(
        `User ${user.id} missing permissions: ${requiredPermissions.map((p) => `${p.resource}:${p.action}`).join(', ')}`,
      );
      throw new ForbiddenException('Insufficient permissions for this operation');
    }

    return true;
  }

  private getUser(context: ExecutionContext): AuthenticatedUser | null {
    if (context.getType() === 'http') {
      return context.switchToHttp().getRequest().user;
    }
    const gqlCtx = GqlExecutionContext.create(context);
    return gqlCtx.getContext().req?.user;
  }
}
