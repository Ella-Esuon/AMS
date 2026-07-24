import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

const { combine, timestamp, errors, json, colorize } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    isDev
      ? combine(
          colorize({ all: true }),
          nestWinstonModuleUtilities.format.nestLike('AMS', {
            colors: true,
            prettyPrint: true,
          }),
        )
      : json(),
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
    ...(process.env.LOG_FILE_PATH
      ? [
          new winston.transports.File({
            filename: process.env.LOG_FILE_PATH,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
          }),
          new winston.transports.File({
            filename: process.env.LOG_FILE_PATH?.replace('.log', '.error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5,
          }),
        ]
      : []),
  ],
  exitOnError: false,
};
