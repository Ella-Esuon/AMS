import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const ABAC_POLICY_KEY = 'abac_policy';

export interface PermissionDef {
  resource: string;
  action: string;
  scope?: 'own' | 'tenant' | 'global';
}

export interface AbacPolicyDef {
  resource: string;
  action: string;
  conditions?: Record<string, unknown>;
}

export const RequirePermissions = (...permissions: PermissionDef[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequirePolicy = (policy: AbacPolicyDef) =>
  SetMetadata(ABAC_POLICY_KEY, policy);

export const Public = () => SetMetadata('isPublic', true);

export const SuperAdminOnly = () => SetMetadata('superAdminOnly', true);

export const SkipTenantCheck = () => SetMetadata('skipTenantCheck', true);
