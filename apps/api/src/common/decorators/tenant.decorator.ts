import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { TenantContext } from '../types/request.types';

export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext): TenantContext | string | unknown => {
    let req: { tenantId?: string; tenant?: TenantContext };

    if (ctx.getType() === 'http') {
      req = ctx.switchToHttp().getRequest();
    } else {
      const gqlCtx = GqlExecutionContext.create(ctx);
      req = gqlCtx.getContext().req;
    }

    if (data === 'id') return req?.tenantId;
    return data ? req?.tenant?.[data] : req?.tenant;
  },
);

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    let req: { tenantId?: string };

    if (ctx.getType() === 'http') {
      req = ctx.switchToHttp().getRequest();
    } else {
      const gqlCtx = GqlExecutionContext.create(ctx);
      req = gqlCtx.getContext().req;
    }

    return req?.tenantId || '';
  },
);
