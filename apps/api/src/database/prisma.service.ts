import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Scope,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { getCurrentTenantId, tenantContextStorage } from './tenant-context';

// Raw client methods that must run on the same connection as an active
// per-request transaction so they see/affect the RLS session GUCs.
const RAW_QUERY_METHODS = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']);

/**
 * Wraps a PrismaService instance so that, whenever a request is running
 * inside PrismaService.runRequestInTenantScope, model delegate calls
 * (prisma.user.findMany(...)) and raw queries are transparently redirected
 * to that request's transaction client instead of the base client. This is
 * what lets every existing service keep calling `this.prisma.user...` while
 * actually executing on the connection that has `app.current_tenant_id` set
 * for Postgres RLS — without threading a `tx` parameter through 149 call
 * sites across 8 modules.
 *
 * Functions are always bound to the real target (never the proxy) so Prisma's
 * internals never observe `this` as anything other than the real client.
 */
function createTenantScopedProxy(target: PrismaService, modelDelegateNames: ReadonlySet<string>): PrismaService {
  return new Proxy(target, {
    get(t, prop, _receiver) {
      if (typeof prop === 'string') {
        const activeTx = tenantContextStorage.getStore()?.tx as Record<string, unknown> | undefined;
        if (activeTx) {
          if (modelDelegateNames.has(prop)) {
            return activeTx[prop];
          }
          if (RAW_QUERY_METHODS.has(prop)) {
            return (activeTx[prop] as (...args: unknown[]) => unknown).bind(activeTx);
          }
        }
      }
      const value = Reflect.get(t, prop, t);
      return typeof value === 'function' ? value.bind(t) : value;
    },
  }) as PrismaService;
}

// Every model that carries a tenantId column. Role is the one exception where
// tenantId is nullable (global/system roles have tenantId = null).
const TENANT_SCOPED_MODELS = new Set([
  'AttendanceBreak',
  'AttendancePolicy',
  'AttendanceRecord',
  'AuditLog',
  'Department',
  'LeaveBalance',
  'LeaveRequest',
  'LeaveType',
  'Location',
  'RefreshToken',
  'Role',
  'Shift',
  'ShiftAssignment',
  'ShiftBreakRule',
  'ShiftRotation',
  'ShiftRotationSlot',
  'User',
  'UserPolicy',
  'UserProfile',
  'UserRole',
]);
const NULLABLE_TENANT_MODELS = new Set(['Role']);

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable({ scope: Scope.DEFAULT })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({
      datasources: {
        db: { url: config.get<string>('database.url') },
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'stdout', level: 'info' },
      ],
      errorFormat: 'colorless',
    });

    // Log slow queries in development
    if (config.get<string>('app.nodeEnv') !== 'production') {
      (this.$on as (event: string, callback: (e: Prisma.QueryEvent) => void) => void)(
        'query',
        (e: Prisma.QueryEvent) => {
          if (e.duration > 200) {
            this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
          }
        },
      );
    }

    (this.$on as (event: string, callback: (e: { message: string; target: string }) => void) => void)(
      'error',
      (e: { message: string; target: string }) => {
        this.logger.error(`Prisma error on ${e.target}: ${e.message}`);
      },
    );

    const modelDelegateNames = new Set(
      Prisma.dmmf.datamodel.models.map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1)),
    );
    // eslint-disable-next-line no-constructor-return
    return createTenantScopedProxy(this, modelDelegateNames);
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');

      // Apply Prisma middleware for soft-delete and tenant scoping
      this.applyMiddleware();
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  // ─── Tenant Context ────────────────────────────────────────────────────────

  /**
   * Runs `work` for the lifetime of one HTTP/GraphQL request inside a single
   * Postgres transaction with `app.current_tenant_id` (and `app.bypass_rls`)
   * set on that transaction's connection, so RLS policies actually see the
   * request's tenant. Called once by TenantMiddleware; every other service
   * keeps calling `this.prisma.<model>...` as before — the proxy above routes
   * those calls to this transaction's client for the duration of `work`.
   */
  async runRequestInTenantScope(tenantId: string, bypassRls: boolean, work: () => Promise<void>): Promise<void> {
    await this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', ${bypassRls.toString()}, true)`;
        await tenantContextStorage.run({ tenantId, tx }, work);
      },
      // Generous ceiling: this transaction spans the whole request (including
      // any non-DB async work the request does), not just DB statements.
      { maxWait: 5000, timeout: 20000 },
    );
  }

  async withTenantContext<T>(
    tenantId: string,
    callback: (tx: PrismaTransactionClient) => Promise<T>,
    bypassRls = false,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // Set PostgreSQL session variables for RLS
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', ${bypassRls.toString()}, true)`;
      return callback(tx);
    });
  }

  async withSuperAdminContext<T>(
    callback: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
      return callback(tx);
    });
  }

  async setTenantContext(tenantId: string, bypassRls = false): Promise<void> {
    await this.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await this.$executeRaw`SELECT set_config('app.bypass_rls', ${bypassRls.toString()}, true)`;
  }

  async clearTenantContext(): Promise<void> {
    await this.$executeRaw`SELECT set_config('app.current_tenant_id', '', true)`;
    await this.$executeRaw`SELECT set_config('app.bypass_rls', 'false', true)`;
  }

  // ─── Soft Delete Helpers ──────────────────────────────────────────────────

  private applyMiddleware() {
    // Exclude soft-deleted records from queries automatically
    this.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<unknown>) => {
      const softDeleteModels = ['User', 'Tenant', 'Department', 'Role', 'Location'];

      if (softDeleteModels.includes(params.model || '')) {
        if (params.action === 'findUnique' || params.action === 'findFirst') {
          params.action = 'findFirst';
          params.args.where = { ...params.args.where, deletedAt: null };
        }
        if (params.action === 'findMany') {
          params.args = params.args || {};
          params.args.where = { ...params.args.where, deletedAt: null };
        }
      }

      return next(params);
    });

    // Backstop tenant scoping: even if a service forgets an explicit
    // `where: { tenantId }` filter, reads/aggregates/bulk-writes on
    // tenant-scoped models are still confined to the request's tenant
    // (populated via AsyncLocalStorage by TenantMiddleware). This does not
    // cover singular update/delete/upsert, since Prisma only allows unique
    // fields in their `where` — those rely on each service's existing
    // find-then-mutate pattern (already audited as tenant-safe).
    this.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<unknown>) => {
      const model = params.model;
      if (!model || !TENANT_SCOPED_MODELS.has(model)) {
        return next(params);
      }

      const tenantId = getCurrentTenantId();
      if (!tenantId) {
        // No authenticated tenant context (e.g. registration, health checks) —
        // leave the query untouched; callers are responsible for scoping.
        return next(params);
      }

      const tenantFilter = NULLABLE_TENANT_MODELS.has(model)
        ? { OR: [{ tenantId: null }, { tenantId }] }
        : { tenantId };

      switch (params.action) {
        case 'findUnique':
        case 'findUniqueOrThrow':
        case 'findFirst':
        case 'findFirstOrThrow': {
          params.action = params.action.endsWith('OrThrow') ? 'findFirstOrThrow' : 'findFirst';
          params.args = params.args || {};
          params.args.where = { AND: [params.args.where || {}, tenantFilter] };
          break;
        }
        case 'findMany':
        case 'count':
        case 'aggregate':
        case 'groupBy':
        case 'updateMany':
        case 'deleteMany': {
          params.args = params.args || {};
          params.args.where = { AND: [params.args.where || {}, tenantFilter] };
          break;
        }
        case 'create': {
          params.args = params.args || {};
          if (params.args.data && params.args.data.tenantId === undefined) {
            params.args.data.tenantId = tenantId;
          }
          break;
        }
        default:
          break;
      }

      return next(params);
    });
  }

  // ─── Transaction Helpers ──────────────────────────────────────────────────

  async executeInTransaction<T>(
    callback: (tx: PrismaTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    // This opens its own transaction on its own connection, separate from
    // any request-scoped transaction runRequestInTenantScope already holds —
    // so it must re-set the RLS GUC itself using the ambient tenant id rather
    // than inheriting it. No-op when there's no ambient tenant (e.g. tenant
    // self-registration, which explicitly sets bypass_rls itself).
    const tenantId = getCurrentTenantId();
    return this.$transaction(
      async (tx) => {
        if (tenantId) {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'false', true)`;
        }
        return callback(tx);
      },
      {
        maxWait: options?.maxWait || 5000,
        timeout: options?.timeout || 15000,
      },
    );
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
