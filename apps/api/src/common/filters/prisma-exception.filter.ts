import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';
    let error = 'DatabaseError';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const fields = (exception.meta?.target as string[])?.join(', ') || 'field';
          message = `A record with this ${fields} already exists`;
          error = 'UniqueConstraintViolation';
          break;
        }
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = (exception.meta?.cause as string) || 'Record not found';
          error = 'RecordNotFound';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Foreign key constraint violation';
          error = 'ForeignKeyViolation';
          break;
        case 'P2014':
          status = HttpStatus.BAD_REQUEST;
          message = 'Relation violation — the change would violate a required relation';
          error = 'RelationViolation';
          break;
        case 'P2016':
          status = HttpStatus.BAD_REQUEST;
          message = 'Query interpretation error';
          error = 'QueryError';
          break;
        default:
          this.logger.error(`Prisma error ${exception.code}: ${exception.message}`, exception.stack);
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      error = 'ValidationError';
      this.logger.error(`Prisma validation error: ${exception.message}`);
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
