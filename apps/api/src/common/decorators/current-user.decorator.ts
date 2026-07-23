import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthenticatedUser } from '../types/request.types';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext): AuthenticatedUser | unknown => {
    let user: AuthenticatedUser;

    if (ctx.getType() === 'http') {
      user = ctx.switchToHttp().getRequest().user;
    } else {
      const gqlCtx = GqlExecutionContext.create(ctx);
      user = gqlCtx.getContext().req?.user;
    }

    return data ? user?.[data] : user;
  },
);
