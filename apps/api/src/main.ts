import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { winstonConfig } from './config/logger.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(winstonConfig),
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const apiPrefix = config.get<string>('app.apiPrefix', 'api/v1');
  const nodeEnv = config.get<string>('app.nodeEnv', 'development');

  // ─── Security ────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production',
      crossOriginEmbedderPolicy: nodeEnv === 'production',
    }),
  );

  // ─── CORS ────────────────────────────────────────────────────────────────────
  const corsOrigins = config.get<string>('app.corsOrigins', 'http://localhost:3001');
  app.enableCors({
    origin: corsOrigins.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-ID',
      'X-Request-ID',
      'X-API-Version',
    ],
    credentials: true,
    maxAge: 86400,
  });

  // ─── Compression ─────────────────────────────────────────────────────────────
  app.use(compression());

  // ─── Global Prefix ───────────────────────────────────────────────────────────
  app.setGlobalPrefix(apiPrefix, {
    exclude: ['/health', '/graphql'],
  });

  // ─── Global Pipes ────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: nodeEnv === 'production',
    }),
  );

  // ─── Global Interceptors ─────────────────────────────────────────────────────
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new LoggingInterceptor(),
  );

  // ─── Global Filters ──────────────────────────────────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  // ─── Swagger (non-production) ────────────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AMS API')
      .setDescription('Multi-Tenant Attendance Management System REST API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addApiKey({ type: 'apiKey', name: 'X-Tenant-ID', in: 'header' }, 'TenantID')
      .addTag('Auth', 'Authentication & Authorization')
      .addTag('Tenants', 'Tenant Management')
      .addTag('Users', 'User Management')
      .addTag('Roles', 'Role & Permission Management')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger: http://localhost:${port}/api/docs`);
  }

  // ─── Shutdown Hooks ──────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  logger.log(`Application running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`GraphQL Playground: http://localhost:${port}/graphql`);
  logger.log(`Environment: ${nodeEnv}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
