import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startTime = Date.now();

    let operationName = '';
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      operationName = `${req.method} ${req.url}`;
    } else {
      const gqlCtx = GqlExecutionContext.create(context);
      const info = gqlCtx.getInfo();
      operationName = `GraphQL ${info?.parentType?.name}.${info?.fieldName}`;
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        if (duration > 1000) {
          this.logger.warn(`SLOW [${operationName}] ${duration}ms`);
        }
      }),
      catchError((err) => {
        const duration = Date.now() - startTime;
        this.logger.debug(`[${operationName}] failed after ${duration}ms: ${err.message}`);
        throw err;
      }),
    );
  }
}
