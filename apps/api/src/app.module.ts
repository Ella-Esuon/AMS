import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { Response } from 'express';
import { RequestWithTenant } from './common/types/request.types';

import { configuration, validationSchema } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { RequestLoggerMiddleware } from './common/middleware/logger.middleware';

// Feature Modules
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { HealthModule } from './modules/health/health.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    // ─── Configuration ─────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      expandVariables: true,
    }),

    // ─── GraphQL ───────────────────────────────────────────────────────────────
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,
        playground: config.get('app.nodeEnv') !== 'production',
        introspection: config.get('app.nodeEnv') !== 'production',
        context: ({ req, res, connection }: { req: RequestWithTenant; res: Response; connection?: unknown }) => ({
          req,
          res,
          connection,
          tenantId: req?.tenantId,
          user: req?.user,
        }),
        formatError: (error) => {
          const isDev = config.get('app.nodeEnv') !== 'production';
          return {
            message: error.message,
            code: error.extensions?.code,
            locations: isDev ? error.locations : undefined,
            path: error.path,
            extensions: isDev ? error.extensions : { code: error.extensions?.code },
          };
        },
        subscriptions: {
          'graphql-ws': true,
          'subscriptions-transport-ws': false,
        },
        includeStacktraceInErrorResponses: config.get('app.nodeEnv') !== 'production',
      }),
    }),

    // ─── Rate Limiting ─────────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('throttle.ttl', 60) * 1000,
            limit: config.get<number>('throttle.limit', 100),
          },
        ],
      }),
    }),

    // ─── Event Emitter ─────────────────────────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // ─── Scheduler ─────────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Infrastructure ────────────────────────────────────────────────────────
    DatabaseModule,

    // ─── Feature Modules ───────────────────────────────────────────────────────
    AuthModule,
    TenantsModule,
    UsersModule,
    RolesModule,
    HealthModule,
    AttendanceModule,
    ShiftsModule,
    LeavesModule,
    NotificationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'api/v1/auth/login', method: RequestMethod.POST },
        { path: 'api/v1/auth/register', method: RequestMethod.POST },
        { path: 'api/v1/tenants/register', method: RequestMethod.POST },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
