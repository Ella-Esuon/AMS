import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export enum SystemRole {
  SUPER_ADMIN = 'super_admin',
  TENANT_ADMIN = 'tenant_admin',
  HR_MANAGER = 'hr_manager',
  DEPARTMENT_MANAGER = 'department_manager',
  EMPLOYEE = 'employee',
  CONTRACTOR = 'contractor',
  VISITOR = 'visitor',
  SECURITY_OFFICER = 'security_officer',
}

export const Roles = (...roles: (SystemRole | string)[]) => SetMetadata(ROLES_KEY, roles);
