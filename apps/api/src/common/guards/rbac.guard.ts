import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/request.types';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = this.getUser(context);
    if (!user) throw new ForbiddenException('Authentication required');

    // Super admin bypasses all role checks
    if (user.roles.includes('super_admin') || user.userType === 'SUPER_ADMIN') {
      return true;
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      this.logger.warn(
        `User ${user.id} (${user.email}) attempted access without required roles: [${requiredRoles.join(', ')}]. Has: [${user.roles.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient permissions. Required roles: ${requiredRoles.join(', ')}`,
      );
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
