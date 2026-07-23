import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();

    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);

    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;
      const contentLength = res.get('content-length');

      const logMessage = `${method} ${originalUrl} ${statusCode} ${duration}ms ${contentLength || '-'}B - ${ip} "${userAgent}"`;

      if (statusCode >= 500) {
        this.logger.error(logMessage, { requestId });
      } else if (statusCode >= 400) {
        this.logger.warn(logMessage, { requestId });
      } else {
        this.logger.log(logMessage, { requestId });
      }
    });

    next();
  }
}
