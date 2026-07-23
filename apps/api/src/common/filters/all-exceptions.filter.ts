import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GqlArgumentsHost, GqlExceptionFilter } from '@nestjs/graphql';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  requestId: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter, GqlExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.getType<'http' | 'graphql' | 'rpc' | 'ws'>();

    if (ctx === 'http') {
      return this.handleHttpException(exception, host);
    }

    if (ctx === 'graphql') {
      return this.handleGqlException(exception, host);
    }

    this.logger.error('Unhandled exception in unknown context', exception);
  }

  private handleHttpException(exception: unknown, host: ArgumentsHost) {
    const httpHost = host.switchToHttp();
    const response = httpHost.getResponse<Response>();
    const request = httpHost.getRequest<Request>();

    const { status, body } = this.extractError(exception, request);

    this.logError(exception, request.url, status);

    response.status(status).json(body);
  }

  private handleGqlException(exception: unknown, host: ArgumentsHost) {
    const gqlHost = GqlArgumentsHost.create(host);
    const ctx = gqlHost.getContext();
    const request = ctx?.req;

    const { status } = this.extractError(exception, request);
    this.logError(exception, 'GraphQL', status);

    return exception;
  }

  private extractError(exception: unknown, request?: Request) {
 const requestId = 
((request as unknown as { requestId?: string })?.requestId) ?? uuidv4();
    const path = request?.url || 'unknown';

    let status: number;
    let message: string | string[];
    let error: string;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, unknown>;
        message = (res.message as string | string[]) || exception.message;
        error = (res.error as string) || 'Error';
        details = res.details;
      } else {
        message = exceptionResponse as string;
        error = exception.name;
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = process.env.NODE_ENV === 'production' ? 'Internal server error' : exception.message;
      error = 'InternalServerError';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      error = 'InternalServerError';
    }

    const body: ErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path,
      requestId,
      ...(details !== undefined && { details }),
    };

    return { status, body };
  }

  private logError(exception: unknown, path: string, status: number) {
    if (status >= 500) {
      this.logger.error(
        `[${path}] ${status} - ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status >= 400) {
      this.logger.warn(
        `[${path}] ${status} - ${exception instanceof Error ? exception.message : 'Client error'}`,
      );
    }
  }
}
