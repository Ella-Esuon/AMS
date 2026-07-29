import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CreateUserDto, InviteUserDto } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';

const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatar: true,
  phone: true,
  employeeId: true,
  userType: true,
  status: true,
  departmentId: true,
  managerId: true,
  locationId: true,
  timezone: true,
  locale: true,
  mfaEnabled: true,
  lastLoginAt: true,
  lastLoginIp: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true } },
  userRoles: {
    where: { isActive: true },
    include: { role: { select: { id: true, name: true, slug: true } } },
  },
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Query ────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: QueryUsersDto) {
    const { page, limit, search, sortBy = 'createdAt', sortOrder = 'desc',
      userType, status, departmentId, managerId, roleSlug } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where = {
      tenantId,
      deletedAt: null,
      ...(userType && { userType }),
      ...(status && { status }),
      ...(departmentId && { departmentId }),
      ...(managerId && { managerId }),
      ...(roleSlug && {
        userRoles: {
          some: { isActive: true, role: { slug: roleSlug } },
        },
      }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { employeeId: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      nodes: users,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(id: string, tenantId: string) {
    const cacheKey = this.redis.buildTenantKey(tenantId, 'user', id);
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const user = await this.prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        ...USER_SELECT,
        profile: true,
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    await this.redis.set(cacheKey, user, 60);
    return user;
  }

  async findByEmail(email: string, tenantId: string) {
    return this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), tenantId, deletedAt: null },
      select: USER_SELECT,
    });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateUserDto, createdBy: string) {
    // Check tenant user limits
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { maxUsers: true, plan: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const userCount = await this.prisma.user.count({
      where: { tenantId, status: { not: 'INACTIVE' }, deletedAt: null },
    });

    if (userCount >= tenant.maxUsers) {
      throw new ForbiddenException(
        `User limit of ${tenant.maxUsers} reached. Upgrade your plan to add more users.`,
      );
    }

    // Check email uniqueness
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), tenantId },
    });
    if (existing) throw new ConflictException('A user with this email already exists');

    // Check employee ID uniqueness
    if (dto.employeeId) {
      const existingEmpId = await this.prisma.user.findFirst({
        where: { employeeId: dto.employeeId, tenantId },
      });
      if (existingEmpId) throw new ConflictException('Employee ID is already in use');
    }

    const password = dto.password || this.generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await this.prisma.executeInTransaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId,
          email: dto.email.toLowerCase(),
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          userType: dto.userType || 'EMPLOYEE',
          employeeId: dto.employeeId,
          departmentId: dto.departmentId,
          managerId: dto.managerId,
          locationId: dto.locationId,
          timezone: dto.timezone,
          status: 'PENDING_VERIFICATION',
          joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
          passwordHash,
          metadata: { temporaryPassword: !dto.password },
        },
        select: USER_SELECT,
      });

      // Assign roles
      if (dto.roleIds?.length) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            userId: created.id,
            roleId,
            tenantId,
            assignedBy: createdBy,
          })),
          skipDuplicates: true,
        });
      } else {
        // Assign default role
        const defaultRole = await tx.role.findFirst({
          where: { tenantId, isDefault: true, deletedAt: null },
        });
        if (defaultRole) {
          await tx.userRole.create({
            data: { userId: created.id, roleId: defaultRole.id, tenantId, assignedBy: createdBy },
          });
        }
      }

      // Create profile placeholder
      await tx.userProfile.create({
        data: { userId: created.id, tenantId },
      });

      return created;
    });

    this.eventEmitter.emit('user.created', {
      userId: user.id,
      tenantId,
      email: user.email,
      createdBy,
      sendWelcomeEmail: dto.sendWelcomeEmail !== false,
      temporaryPassword: !dto.password ? password : undefined,
    });

    this.logger.log(`User created: ${user.email} in tenant ${tenantId}`);
    return user;
  }

  async invite(tenantId: string, dto: InviteUserDto, invitedBy: string) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), tenantId },
    });
    if (existing) throw new ConflictException('User with this email already exists');

    const inviteToken = crypto.randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        userType: dto.userType || 'EMPLOYEE',
        departmentId: dto.departmentId,
        status: 'PENDING_VERIFICATION',
        metadata: { inviteToken, invitedBy, invitedAt: new Date().toISOString() },
      },
      select: USER_SELECT,
    });

    if (dto.roleIds?.length) {
      await this.prisma.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId: user.id, roleId, tenantId, assignedBy: invitedBy })),
        skipDuplicates: true,
      });
    }

    this.eventEmitter.emit('user.invited', {
      userId: user.id,
      tenantId,
      email: user.email,
      inviteToken,
      invitedBy,
    });

    return { message: `Invitation sent to ${dto.email}`, userId: user.id };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, tenantId: string, dto: UpdateUserDto, updatedBy: string) {
    await this.findOne(id, tenantId);

    if (dto.employeeId) {
      const existing = await this.prisma.user.findFirst({
        where: { employeeId: dto.employeeId, tenantId, id: { not: id } },
      });
      if (existing) throw new ConflictException('Employee ID is already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
      },
      select: USER_SELECT,
    });

    await this.invalidateUserCache(id, tenantId);

    this.eventEmitter.emit('user.updated', {
      userId: id,
      tenantId,
      updatedBy,
      changes: dto,
    });

    return updated;
  }

  async updateStatus(id: string, tenantId: string, dto: UpdateUserStatusDto, updatedBy: string) {
    const user = await this.findOne(id, tenantId);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: USER_SELECT,
    });

    await this.invalidateUserCache(id, tenantId);

    this.eventEmitter.emit('user.status.changed', {
      userId: id,
      tenantId,
      from: (user as { status: string }).status,
      to: dto.status,
      reason: dto.reason,
      changedBy: updatedBy,
    });

    return updated;
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async softDelete(id: string, tenantId: string, deletedBy: string) {
    await this.findOne(id, tenantId);

    if (id === deletedBy) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE', email: `${id}__deleted__${Date.now()}` },
    });

    // Revoke tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, isRevoked: false },
      data: { isRevoked: true, revokedReason: 'user_deleted', revokedAt: new Date() },
    });

    await this.invalidateUserCache(id, tenantId);
    await this.redis.del(`user:auth:${id}`);

    this.eventEmitter.emit('user.deleted', { userId: id, tenantId, deletedBy });

    return { message: 'User deleted successfully', success: true };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(userId: string, tenantId: string) {
    const profile = await this.prisma.userProfile.findFirst({
      where: { userId, tenantId },
    });
    if (!profile) throw new NotFoundException('User profile not found');
    return profile;
  }

  async updateProfile(userId: string, tenantId: string, data: Record<string, unknown>) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, tenantId, ...data },
    });
  }

  // ─── Role Assignment ──────────────────────────────────────────────────────

  async assignRoles(userId: string, tenantId: string, roleIds: string[], assignedBy: string) {
    await this.findOne(userId, tenantId);

    await this.prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId, roleId, tenantId, assignedBy })),
      skipDuplicates: true,
    });

    await this.invalidateUserCache(userId, tenantId);
    await this.redis.del(`user:auth:${userId}`);

    this.eventEmitter.emit('user.roles.assigned', { userId, tenantId, roleIds, assignedBy });

    return { message: 'Roles assigned successfully', success: true };
  }

  async revokeRole(userId: string, tenantId: string, roleId: string, _revokedBy: string) {
    await this.prisma.userRole.updateMany({
      where: { userId, roleId, tenantId },
      data: { isActive: false },
    });

    await this.invalidateUserCache(userId, tenantId);
    await this.redis.del(`user:auth:${userId}`);

    return { message: 'Role revoked successfully', success: true };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateTempPassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@!#$';
    let password = '';
    // Ensure at least one of each required character type
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
    password += '0123456789'[Math.floor(Math.random() * 10)];
    password += '@!#$'[Math.floor(Math.random() * 4)];
    for (let i = 4; i < 12; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  private async invalidateUserCache(userId: string, tenantId: string) {
    await Promise.all([
      this.redis.del(this.redis.buildTenantKey(tenantId, 'user', userId)),
      this.redis.del(`user:auth:${userId}`),
    ]);
  }
}
