import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as slugify from 'slugify';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, CreatePermissionDto, CreatePolicyDto } from './dto/create-role.dto';
import { buildPaginationMeta, buildPrismaSkipTake, PaginationArgs } from '../../common/types/pagination.types';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Roles ────────────────────────────────────────────────────────────────

  async findAllRoles(tenantId: string, args: PaginationArgs) {
    const { page, limit, search, sortBy = 'priority', sortOrder = 'desc' } = args;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where = {
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      deletedAt: null,
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };

    const [roles, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          _count: { select: { userRoles: true, rolePermissions: true } },
          rolePermissions: { include: { permission: true } },
        },
      }),
      this.prisma.role.count({ where }),
    ]);

    return {
      nodes: roles.map((r) => ({
        ...r,
        userCount: r._count.userRoles,
        permissionCount: r._count.rolePermissions,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOneRole(id: string, tenantId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id,
        OR: [{ tenantId }, { tenantId: null, isSystem: true }],
        deletedAt: null,
      },
      include: {
        rolePermissions: {
          include: { permission: true },
          orderBy: { permission: { resource: 'asc' } },
        },
        _count: { select: { userRoles: true } },
      },
    });

    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(tenantId: string, dto: CreateRoleDto, createdBy: string) {
    const slug = dto.slug || (slugify as unknown as (s: string, o: object) => string)(dto.name, {
      lower: true, strict: true,
    }).replace(/-/g, '_');

    const existing = await this.prisma.role.findFirst({
      where: { tenantId, slug, deletedAt: null },
    });
    if (existing) throw new ConflictException('A role with this name/slug already exists');

    const role = await this.prisma.role.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        description: dto.description,
        priority: dto.priority || 0,
        scope: 'TENANT',
      },
    });

    // Assign permissions
    if (dto.permissionIds?.length) {
      await this.prisma.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
          grantedBy: createdBy,
        })),
        skipDuplicates: true,
      });
    }

    await this.invalidateRoleCache(tenantId);
    this.eventEmitter.emit('role.created', { roleId: role.id, tenantId, createdBy });

    return this.findOneRole(role.id, tenantId);
  }

  async updateRole(id: string, tenantId: string, dto: UpdateRoleDto) {
    const role = await this.findOneRole(id, tenantId);

    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be modified');
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: dto,
    });

    await this.invalidateRoleCache(tenantId);
    return updated;
  }

  async deleteRole(id: string, tenantId: string) {
    const role = await this.findOneRole(id, tenantId);

    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    if (role.isDefault) throw new ForbiddenException('Default role cannot be deleted');

    const usersWithRole = await this.prisma.userRole.count({ where: { roleId: id, isActive: true } });
    if (usersWithRole > 0) {
      throw new BadRequestException(
        `Cannot delete role — ${usersWithRole} user(s) still have this role assigned`,
      );
    }

    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.invalidateRoleCache(tenantId);

    return { message: 'Role deleted successfully', success: true };
  }

  // ─── Permissions ─────────────────────────────────────────────────────────

  async findAllPermissions(args: PaginationArgs, category?: string) {
    const { page, limit, search } = args;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where = {
      isActive: true,
      ...(category && { category }),
      ...(search && {
        OR: [
          { resource: { contains: search, mode: 'insensitive' as const } },
          { action: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [permissions, total] = await Promise.all([
      this.prisma.permission.findMany({
        where,
        skip,
        take,
        orderBy: [{ category: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
      }),
      this.prisma.permission.count({ where }),
    ]);

    // Group by category
    const grouped = permissions.reduce(
      (acc, perm) => {
        const cat = perm.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(perm);
        return acc;
      },
      {} as Record<string, typeof permissions>,
    );

    return { permissions, grouped, meta: buildPaginationMeta(total, page, limit) };
  }

  async createPermission(dto: CreatePermissionDto) {
    const existing = await this.prisma.permission.findFirst({
      where: { resource: dto.resource, action: dto.action, scope: dto.scope || 'tenant' },
    });
    if (existing) throw new ConflictException('Permission already exists');

    return this.prisma.permission.create({ data: { ...dto, scope: dto.scope || 'tenant' } });
  }

  async assignPermissionsToRole(roleId: string, tenantId: string, dto: AssignPermissionsDto, grantedBy: string) {
    await this.findOneRole(roleId, tenantId);

    await this.prisma.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({ roleId, permissionId, grantedBy })),
      skipDuplicates: true,
    });

    await this.invalidateRoleCache(tenantId);

    // Invalidate all user caches for this role
    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId, isActive: true },
      select: { userId: true },
    });

    await Promise.all(
      userRoles.map((ur) => this.redis.del(`user:auth:${ur.userId}`)),
    );

    return { message: 'Permissions assigned successfully', success: true };
  }

  async revokePermissionFromRole(roleId: string, tenantId: string, permissionId: string) {
    const role = await this.findOneRole(roleId, tenantId);
    if (role.isSystem) throw new ForbiddenException('Cannot modify system role permissions');

    await this.prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
    await this.invalidateRoleCache(tenantId);

    return { message: 'Permission revoked successfully', success: true };
  }

  // ─── ABAC Policies ────────────────────────────────────────────────────────

  async findPolicies(tenantId: string, userId?: string) {
    return this.prisma.userPolicy.findMany({
      where: {
        tenantId,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
      orderBy: [{ priority: 'desc' }, { effect: 'asc' }],
    });
  }

  async createPolicy(tenantId: string, dto: CreatePolicyDto, createdBy: string) {
    return this.prisma.userPolicy.create({
      data: {
        tenantId,
        userId: dto.userId,
        name: dto.name,
        description: dto.description,
        effect: dto.effect,
        resources: dto.resources,
        actions: dto.actions,
        conditions: dto.conditions as never,
        priority: dto.priority || 0,
      },
    });
  }

  async deletePolicy(id: string, tenantId: string) {
    const policy = await this.prisma.userPolicy.findFirst({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException('Policy not found');

    await this.prisma.userPolicy.delete({ where: { id } });
    return { message: 'Policy deleted', success: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async invalidateRoleCache(tenantId: string) {
    await this.redis.deleteByPattern(`tenant:${tenantId}:*roles*`);
  }
}
