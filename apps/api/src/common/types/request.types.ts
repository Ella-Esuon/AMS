import { Request } from 'express';
import { User, Tenant } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  userType: string;
  roles: string[];
  permissions: string[];
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  sessionId?: string;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: string;
  roles: string[];
  permissions: string[];
  cognitoSub?: string | null;
  mfaEnabled: boolean;
  sessionId?: string;
}

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  timezone: string;
  features: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  tenantId: string;
  tenant: TenantContext;
  requestId: string;
  startTime: number;
}

export type RequestWithTenant = Request & {
  tenantId?: string;
  tenant?: TenantContext;
  requestId?: string;
  startTime?: number;
};
