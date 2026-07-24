import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import slugify from 'slugify';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CreateTenantDto, RegisterTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto, UpdateTenantStatusDto } from './dto/update-tenant.dto';
import { PaginationArgs, buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';

const TENANT_CACHE_PREFIX = 'tenant:';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Tenant Self-Registration ─────────────────────────────────────────────

  async registerTenant(dto: RegisterTenantDto) {
    const slug = await this.generateUniqueSlug(dto.slug || dto.name);

    const existing = await this.prisma.tenant.findFirst({
      where: {
        OR: [
          { slug },
          { contactEmail: dto.contactEmail.toLowerCase() },
          ...(dto.domain ? [{ domain: dto.domain }] : []),
        ],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.slug === slug
          ? 'A tenant with this name already exists'
          : existing.domain === dto.domain
          ? 'This domain is already registered'
          : 'This email is already registered',
      );
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial

    // Create tenant + admin user in a transaction
    const result = await this.prisma.executeInTransaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          domain: dto.domain,
          contactEmail: dto.contactEmail.toLowerCase(),
          contactPhone: dto.contactPhone,
          plan: dto.plan || 'FREE',
          status: 'TRIAL',
          maxUsers: dto.maxUsers || 10,
          timezone: dto.timezone || 'UTC',
          locale: dto.locale || 'en-US',
          currency: dto.currency || 'USD',
          primaryColor: dto.primaryColor || '#3B82F6',
          trialEndsAt,
          settings: {},
          features: this.getDefaultFeatures(dto.plan || 'FREE'),
        },
      });

      // Provisioning a brand-new tenant's roles/admin user happens before any
      // "current tenant" request context exists (there's no logged-in user or
      // resolved tenant header yet) — bypass RLS for the rest of this
      // transaction rather than leaving these RLS-protected inserts unscoped.
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;

      // Create system roles for this tenant
      const roles = await this.seedTenantRoles(tx, tenant.id);

      // Create admin user
      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      const adminUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.contactEmail.toLowerCase(),
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          userType: 'TENANT_ADMIN',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });

      // Assign admin role
      const adminRole = roles.find((r) => r.slug === 'tenant_admin');
      if (adminRole) {
        await tx.userRole.create({
          data: { userId: adminUser.id, roleId: adminRole.id, tenantId: tenant.id },
        });
      }

      // Create default permissions
      await this.seedSystemPermissions(tx);

      return { tenant, adminUser };
    });

    this.eventEmitter.emit('tenant.registered', {
      tenantId: result.tenant.id,
      tenantSlug: result.tenant.slug,
      adminEmail: result.adminUser.email,
    });

    this.logger.log(`New tenant registered: ${result.tenant.slug} (${result.tenant.id})`);

    return {
      message: 'Tenant registered successfully! Check your email for activation instructions.',
      tenantId: result.tenant.id,
      tenantSlug: result.tenant.slug,
      adminUserId: result.adminUser.id,
      trialEndsAt,
    };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(args: PaginationArgs) {
    const { page, limit, search, sortBy = 'createdAt', sortOrder = 'desc' } = args;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where = {
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { slug: { contains: search, mode: 'insensitive' as const } },
          { contactEmail: { contains: search, mode: 'insensitive' as const } },
          { domain: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: { _count: { select: { users: true } } },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      nodes: tenants.map((t) => ({ ...t, userCount: t._count.users })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

async findOne(id: string): Promise<Prisma.TenantGetPayload<{
  include: { _count: { select: { users: true; departments: true; roles: true } } };
}> & { userCount: number }> {
  const cacheKey = `${TENANT_CACHE_PREFIX}${id}`;

  const cached = await this.redis.get<Prisma.TenantGetPayload<{
    include: { _count: { select: { users: true; departments: true; roles: true } } };
  }> & { userCount: number }>(cacheKey);
  if (cached) return cached;

  const tenant = await this.prisma.tenant.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          users: true,
          departments: true,
          roles: true,
        },
      },
    },
  });

  if (!tenant) {
    throw new NotFoundException('Tenant not found');
  }

  const result = {
    ...tenant,
    userCount: tenant._count.users,
  };

  await this.redis.set(cacheKey, result, 300);

  return result;
}

  async findBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException(`Tenant "${slug}" not found`);
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const slug = await this.generateUniqueSlug(dto.slug || dto.name);
    return this.prisma.tenant.create({
      data: {
        ...dto,
        slug,
        contactEmail: dto.contactEmail.toLowerCase(),
        features: this.getDefaultFeatures(dto.plan || 'FREE'),
        settings: {},
      },
    });
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findOne(id);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { ...dto },
    });

    await this.invalidateTenantCache(id, updated.slug);
    this.eventEmitter.emit('tenant.updated', { tenantId: id });
    return updated;
  }

  async updateStatus(id: string, dto: UpdateTenantStatusDto) {
   const tenant = await this.findOne(id);

    if (tenant.status === dto.status) {
      throw new BadRequestException(`Tenant is already in ${dto.status} status`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.invalidateTenantCache(id, updated.slug);
    this.eventEmitter.emit('tenant.status.changed', {
      tenantId: id,
      from: tenant.status,
      to: dto.status,
      reason: dto.reason,
    });

    return updated;
  }

  async softDelete(id: string) {
    await this.findOne(id);

    const deleted = await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });

    await this.invalidateTenantCache(id, deleted.slug);
    this.eventEmitter.emit('tenant.deleted', { tenantId: id });
    return { message: 'Tenant deleted successfully', success: true };
  }

  async getStats(tenantId: string) {
    const [totalUsers, activeUsers, pendingUsers, departments, roles] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.user.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.user.count({ where: { tenantId, status: 'PENDING_VERIFICATION', deletedAt: null } }),
      this.prisma.department.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.role.count({ where: { tenantId, deletedAt: null } }),
    ]);

    return { totalUsers, activeUsers, pendingUsers, departments, roles };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async generateUniqueSlug(name: string): Promise<string> {
    const baseSlug = slugify(name, {
      lower: true,
      strict: true,
      trim: true,
    });

    let slug = baseSlug;
    let counter = 0;

    while (true) {
      const existing = await this.prisma.tenant.findFirst({ where: { slug } });
      if (!existing) return slug;
      counter++;
      slug = `${baseSlug}-${counter}`;
    }
  }

  private async seedTenantRoles(tx: Parameters<Parameters<PrismaService['executeInTransaction']>[0]>[0], tenantId: string) {
    const roles = [
      { name: 'Tenant Administrator', slug: 'tenant_admin', description: 'Full access to tenant resources', priority: 100 },
      { name: 'HR Manager', slug: 'hr_manager', description: 'Manage employees, leaves and attendance', priority: 80 },
      { name: 'Department Manager', slug: 'department_manager', description: 'Manage department team', priority: 60 },
      { name: 'Employee', slug: 'employee', description: 'Standard employee access', priority: 10, isDefault: true },
      { name: 'Contractor', slug: 'contractor', description: 'Contractor access', priority: 10 },
      { name: 'Visitor', slug: 'visitor', description: 'Visitor access', priority: 5 },
      { name: 'Security Officer', slug: 'security_officer', description: 'Security and audit access', priority: 40 },
    ];

    return Promise.all(
      roles.map((role) =>
        tx.role.create({
          data: { ...role, tenantId, scope: 'TENANT' },
        }),
      ),
    );
  }

  private async seedSystemPermissions(tx: Parameters<Parameters<PrismaService['executeInTransaction']>[0]>[0]) {
    const permissions = [
      // Attendance
      { resource: 'attendance', action: 'create', category: 'Attendance' },
      { resource: 'attendance', action: 'read', category: 'Attendance' },
      { resource: 'attendance', action: 'update', category: 'Attendance' },
      { resource: 'attendance', action: 'delete', category: 'Attendance' },
      { resource: 'attendance', action: 'approve', category: 'Attendance' },
      { resource: 'attendance', action: 'export', category: 'Attendance' },
      // Users
      { resource: 'users', action: 'create', category: 'Users' },
      { resource: 'users', action: 'read', category: 'Users' },
      { resource: 'users', action: 'update', category: 'Users' },
      { resource: 'users', action: 'delete', category: 'Users' },
      { resource: 'users', action: 'invite', category: 'Users' },
      { resource: 'users', action: 'export', category: 'Users' },
      // Departments
      { resource: 'departments', action: 'create', category: 'Organization' },
      { resource: 'departments', action: 'read', category: 'Organization' },
      { resource: 'departments', action: 'update', category: 'Organization' },
      { resource: 'departments', action: 'delete', category: 'Organization' },
      // Leaves
      { resource: 'leaves', action: 'create', category: 'Leaves' },
      { resource: 'leaves', action: 'read', category: 'Leaves' },
      { resource: 'leaves', action: 'update', category: 'Leaves' },
      { resource: 'leaves', action: 'approve', category: 'Leaves' },
      { resource: 'leaves', action: 'reject', category: 'Leaves' },
      // Shifts
      { resource: 'shifts', action: 'create', category: 'Scheduling' },
      { resource: 'shifts', action: 'read', category: 'Scheduling' },
      { resource: 'shifts', action: 'update', category: 'Scheduling' },
      { resource: 'shifts', action: 'delete', category: 'Scheduling' },
      // Reports
      { resource: 'reports', action: 'read', category: 'Reports' },
      { resource: 'reports', action: 'export', category: 'Reports' },
      // Settings
      { resource: 'settings', action: 'read', category: 'Settings' },
      { resource: 'settings', action: 'update', category: 'Settings' },
      // Roles
      { resource: 'roles', action: 'create', category: 'Security' },
      { resource: 'roles', action: 'read', category: 'Security' },
      { resource: 'roles', action: 'update', category: 'Security' },
      { resource: 'roles', action: 'delete', category: 'Security' },
      { resource: 'roles', action: 'assign', category: 'Security' },
      // Audit
      { resource: 'audit', action: 'read', category: 'Security' },
      { resource: 'audit', action: 'export', category: 'Security' },
    ];

    // Upsert permissions (system-wide, shared)
    for (const perm of permissions) {
      await tx.permission.upsert({
        where: { resource_action_scope: { resource: perm.resource, action: perm.action, scope: 'tenant' } },
        update: {},
        create: { ...perm, scope: 'tenant' },
      });
    }
  }

  private getDefaultFeatures(plan: string): Record<string, boolean> {
    const base = {
      attendance: true,
      qrCheckIn: true,
      manualAttendance: true,
      leaveManagement: true,
      reports: true,
      notifications: true,
    };

    const pro = {
      ...base,
      faceRecognition: true,
      gpsGeofencing: true,
      shifts: true,
      visitors: true,
      contractors: true,
      aiInsights: false,
      webhooks: true,
    };

    const enterprise = {
      ...pro,
      aiInsights: true,
      rfidNfc: true,
      fingerprint: true,
      advancedReports: true,
      customBranding: true,
      sso: true,
      apiAccess: true,
    };

    switch (plan) {
      case 'ENTERPRISE': return enterprise;
      case 'PROFESSIONAL': return pro;
      case 'STARTER': return { ...base, shifts: true };
      default: return base;
    }
  }

  private async invalidateTenantCache(id: string, slug: string) {
    await Promise.all([
      this.redis.del(`${TENANT_CACHE_PREFIX}${id}`),
      this.redis.del(`tenant:context:${id}`),
      this.redis.del(`tenant:context:${slug}`),
    ]);
  }
}
