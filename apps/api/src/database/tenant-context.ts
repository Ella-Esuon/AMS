import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextStore {
  tenantId: string;
  /**
   * The interactive-transaction client PrismaService opened for this request
   * (see PrismaService.runRequestInTenantScope), with `app.current_tenant_id`
   * set on its connection for Postgres RLS. When present, PrismaService's
   * proxy routes model/raw queries through it instead of the base client, so
   * a single physical connection carries both the query and the session GUC
   * the RLS policies read.
   */
  tx?: unknown;
}

/**
 * Populated once per request (see TenantMiddleware) from the same req.tenantId
 * that @TenantId()/@CurrentTenant() already expose to controllers. PrismaService
 * reads it to enforce tenant scoping centrally, as a backstop for any query that
 * forgets an explicit `where: { tenantId }` filter.
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContextStore>();

export function getCurrentTenantId(): string | undefined {
  return tenantContextStorage.getStore()?.tenantId;
}
