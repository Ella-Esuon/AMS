import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, AuditAction, AuditStatus, BreakType } from '@prisma/client';
import { differenceInDays, parseISO, addDays, startOfDay, getISODay, set } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CreateShiftDto, CreateBreakRuleDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto, UpdateAssignmentDto } from './dto/assign-shift.dto';
import { QueryShiftDto, QueryAssignmentDto } from './dto/query-shift.dto';
import { CreateRotationDto, UpsertRotationSlotDto } from './dto/shift-rotation.dto';
import { EffectiveShift } from './types/shifts.types';
import { buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';

const SHIFT_CACHE_TTL = 300;

const SHIFT_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  code: true,
  description: true,
  startTime: true,
  endTime: true,
  isNightShift: true,
  workDays: true,
  graceMinutes: true,
  overtimeAfterMinutes: true,
  colorCode: true,
  isActive: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  breakRules: {
    orderBy: { startOffsetMins: 'asc' as const },
  },
} as const;

const ASSIGNMENT_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  shiftId: true,
  rotationId: true,
  startDate: true,
  endDate: true,
  assignedBy: true,
  isActive: true,
  notes: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  shift: {
    select: {
      id: true,
      name: true,
      startTime: true,
      endTime: true,
      isNightShift: true,
      colorCode: true,
    },
  },
} as const;

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Shift CRUD ───────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateShiftDto, actorId: string) {
    if (dto.code) {
      const existing = await this.prisma.shift.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null },
      });
      if (existing) throw new ConflictException(`Shift with code '${dto.code}' already exists.`);
    }

    const shift = await this.prisma.shift.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code ?? null,
        description: dto.description ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isNightShift: dto.isNightShift ?? false,
        workDays: dto.workDays ?? [1, 2, 3, 4, 5],
        graceMinutes: dto.graceMinutes ?? 0,
        overtimeAfterMinutes: dto.overtimeAfterMinutes ?? null,
        colorCode: dto.colorCode ?? null,
      },
      select: SHIFT_SELECT,
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.CREATE, 'shift', shift.id, null, shift);
    this.eventEmitter.emit('shift.created', { tenantId, shiftId: shift.id, actorId });
    this.logger.log(`Shift created: ${shift.id} (${shift.name}) tenant=${tenantId}`);

    return shift;
  }

  async findAll(tenantId: string, query: QueryShiftDto) {
    const { page, limit, isActive, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where: Prisma.ShiftWhereInput = {
      tenantId,
      deletedAt: null,
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [shifts, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        select: SHIFT_SELECT,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.shift.count({ where }),
    ]);

    return { nodes: shifts, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const cacheKey = this.shiftKey(tenantId, id);
    const cached = await this.redis.get<unknown>(cacheKey);
    if (cached) return cached;

    const shift = await this.prisma.shift.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: SHIFT_SELECT,
    });
    if (!shift) throw new NotFoundException('Shift not found');

    await this.redis.set(cacheKey, shift, SHIFT_CACHE_TTL);
    return shift;
  }

  async update(tenantId: string, id: string, dto: UpdateShiftDto, actorId: string) {
    await this.findOne(tenantId, id);

    if (dto.code) {
      const conflict = await this.prisma.shift.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`Shift with code '${dto.code}' already exists.`);
    }

    const shift = await this.prisma.shift.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.isNightShift !== undefined && { isNightShift: dto.isNightShift }),
        ...(dto.workDays !== undefined && { workDays: dto.workDays }),
        ...(dto.graceMinutes !== undefined && { graceMinutes: dto.graceMinutes }),
        ...(dto.overtimeAfterMinutes !== undefined && { overtimeAfterMinutes: dto.overtimeAfterMinutes }),
        ...(dto.colorCode !== undefined && { colorCode: dto.colorCode }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: SHIFT_SELECT,
    });

    await this.redis.del(this.shiftKey(tenantId, id));
    await this.writeAuditLog(tenantId, actorId, AuditAction.UPDATE, 'shift', id, null, dto);
    this.eventEmitter.emit('shift.updated', { tenantId, shiftId: id, actorId, changes: dto });

    return shift;
  }

  async remove(tenantId: string, id: string, actorId: string) {
    await this.findOne(tenantId, id);

    await this.prisma.shift.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.redis.del(this.shiftKey(tenantId, id));
    await this.writeAuditLog(tenantId, actorId, AuditAction.DELETE, 'shift', id, null, null);
    this.eventEmitter.emit('shift.deleted', { tenantId, shiftId: id, actorId });

    return { success: true };
  }

  // ─── Break Rules ──────────────────────────────────────────────────────────

  async addBreakRule(tenantId: string, shiftId: string, dto: CreateBreakRuleDto, actorId: string) {
    await this.findOne(tenantId, shiftId);

    const rule = await this.prisma.shiftBreakRule.create({
      data: {
        tenantId,
        shiftId,
        name: dto.name,
        breakType: dto.breakType ?? BreakType.SHORT_BREAK,
        startOffsetMins: dto.startOffsetMins,
        durationMinutes: dto.durationMinutes,
        isPaid: dto.isPaid ?? false,
        isRequired: dto.isRequired ?? true,
      },
    });

    await this.redis.del(this.shiftKey(tenantId, shiftId));
    this.eventEmitter.emit('shift.break_rule_added', { tenantId, shiftId, ruleId: rule.id, actorId });

    return rule;
  }

  async removeBreakRule(tenantId: string, shiftId: string, ruleId: string, actorId: string) {
    const rule = await this.prisma.shiftBreakRule.findFirst({
      where: { id: ruleId, shiftId, tenantId },
    });
    if (!rule) throw new NotFoundException('Break rule not found');

    await this.prisma.shiftBreakRule.delete({ where: { id: ruleId } });
    await this.redis.del(this.shiftKey(tenantId, shiftId));
    this.eventEmitter.emit('shift.break_rule_removed', { tenantId, shiftId, ruleId, actorId });

    return { success: true };
  }

  // ─── Shift Assignments ────────────────────────────────────────────────────

  async assignShift(tenantId: string, dto: AssignShiftDto, actorId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.shiftId) {
      const shift = await this.prisma.shift.findFirst({
        where: { id: dto.shiftId, tenantId, deletedAt: null, isActive: true },
      });
      if (!shift) throw new NotFoundException('Shift not found or inactive');
    }

    if (dto.rotationId) {
      const rotation = await this.prisma.shiftRotation.findFirst({
        where: { id: dto.rotationId, tenantId, deletedAt: null, isActive: true },
      });
      if (!rotation) throw new NotFoundException('Rotation not found or inactive');
    }

    const endDateBoundary = dto.endDate ? new Date(dto.endDate) : new Date('2099-12-31');

    // Deactivate overlapping assignments and create the new one atomically, at
    // Serializable isolation, so two concurrent assignShift calls for the same
    // user can't both pass the overlap check and leave two active assignments.
    let assignment: Prisma.ShiftAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;
    try {
      assignment = await this.prisma.$transaction(
        async (tx) => {
          await tx.shiftAssignment.updateMany({
            where: {
              tenantId,
              userId: dto.userId,
              isActive: true,
              startDate: { lte: endDateBoundary },
              OR: [{ endDate: null }, { endDate: { gte: new Date(dto.startDate) } }],
            },
            data: { isActive: false },
          });

          return tx.shiftAssignment.create({
            data: {
              tenantId,
              userId: dto.userId,
              shiftId: dto.shiftId ?? null,
              rotationId: dto.rotationId ?? null,
              startDate: new Date(dto.startDate),
              endDate: dto.endDate ? new Date(dto.endDate) : null,
              assignedBy: actorId,
              isActive: true,
              notes: dto.notes ?? null,
            },
            select: ASSIGNMENT_SELECT,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw new ConflictException('Shift assignment conflicted with a concurrent change; please retry');
      }
      throw err;
    }

    await this.writeAuditLog(tenantId, actorId, AuditAction.CREATE, 'shift_assignment', assignment.id, null, assignment);
    this.eventEmitter.emit('shift.assigned', { tenantId, userId: dto.userId, assignmentId: assignment.id, actorId });
    this.logger.log(`Shift assigned: user=${dto.userId} assignment=${assignment.id} tenant=${tenantId}`);

    return assignment;
  }

  async updateAssignment(tenantId: string, assignmentId: string, dto: UpdateAssignmentDto, actorId: string) {
    const existing = await this.prisma.shiftAssignment.findFirst({
      where: { id: assignmentId, tenantId },
    });
    if (!existing) throw new NotFoundException('Assignment not found');

    const assignment = await this.prisma.shiftAssignment.update({
      where: { id: assignmentId },
      data: {
        ...(dto.shiftId !== undefined && { shiftId: dto.shiftId ?? null }),
        ...(dto.rotationId !== undefined && { rotationId: dto.rotationId ?? null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      select: ASSIGNMENT_SELECT,
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.UPDATE, 'shift_assignment', assignmentId, null, dto);
    this.eventEmitter.emit('shift.assignment_updated', { tenantId, assignmentId, actorId });

    return assignment;
  }

  async getAssignments(tenantId: string, query: QueryAssignmentDto) {
    const { page, limit, userId, shiftId, isActive, date, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const targetDate = date ? startOfDay(parseISO(date)) : undefined;

    const where: Prisma.ShiftAssignmentWhereInput = {
      tenantId,
      ...(userId && { userId }),
      ...(shiftId && { shiftId }),
      ...(isActive !== undefined && { isActive }),
      ...(targetDate && {
        startDate: { lte: targetDate },
        OR: [{ endDate: null }, { endDate: { gte: targetDate } }],
      }),
    };

    const [assignments, total] = await Promise.all([
      this.prisma.shiftAssignment.findMany({
        where,
        select: ASSIGNMENT_SELECT,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.shiftAssignment.count({ where }),
    ]);

    return { nodes: assignments, meta: buildPaginationMeta(total, page, limit) };
  }

  async getAssignment(tenantId: string, assignmentId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { id: assignmentId, tenantId },
      select: ASSIGNMENT_SELECT,
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  // ─── Shift Rotations ──────────────────────────────────────────────────────

  async createRotation(tenantId: string, dto: CreateRotationDto, actorId: string) {
    const existing = await this.prisma.shiftRotation.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) throw new ConflictException(`Rotation with name '${dto.name}' already exists.`);

    const rotation = await this.prisma.shiftRotation.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        cycleDays: dto.cycleDays,
        startDate: new Date(dto.startDate),
        isActive: true,
        ...(dto.slots?.length && {
          slots: {
            create: dto.slots.map((s) => ({
              tenantId,
              dayOffset: s.dayOffset,
              shiftId: s.shiftId ?? null,
            })),
          },
        }),
      },
      include: {
        slots: {
          include: { shift: { select: { id: true, name: true } } },
          orderBy: { dayOffset: 'asc' },
        },
      },
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.CREATE, 'shift_rotation', rotation.id, null, { name: dto.name });
    this.eventEmitter.emit('shift.rotation_created', { tenantId, rotationId: rotation.id, actorId });

    return rotation;
  }

  async getRotations(tenantId: string, isActive?: boolean) {
    return this.prisma.shiftRotation.findMany({
      where: { tenantId, deletedAt: null, ...(isActive !== undefined && { isActive }) },
      include: {
        slots: {
          include: { shift: { select: { id: true, name: true, startTime: true, endTime: true } } },
          orderBy: { dayOffset: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRotation(tenantId: string, rotationId: string) {
    const rotation = await this.prisma.shiftRotation.findFirst({
      where: { id: rotationId, tenantId, deletedAt: null },
      include: {
        slots: {
          include: {
            shift: { select: { id: true, name: true, startTime: true, endTime: true, isNightShift: true } },
          },
          orderBy: { dayOffset: 'asc' },
        },
      },
    });
    if (!rotation) throw new NotFoundException('Rotation not found');
    return rotation;
  }

  async upsertRotationSlot(tenantId: string, rotationId: string, dto: UpsertRotationSlotDto, actorId: string) {
    const rotation = await this.getRotation(tenantId, rotationId);

    if (dto.dayOffset < 0 || dto.dayOffset >= rotation.cycleDays) {
      throw new BadRequestException(`dayOffset must be 0–${rotation.cycleDays - 1} for this rotation.`);
    }

    if (dto.shiftId) {
      const shift = await this.prisma.shift.findFirst({
        where: { id: dto.shiftId, tenantId, deletedAt: null },
      });
      if (!shift) throw new NotFoundException('Shift not found');
    }

    const slot = await this.prisma.shiftRotationSlot.upsert({
      where: { rotationId_dayOffset: { rotationId, dayOffset: dto.dayOffset } },
      update: { shiftId: dto.shiftId ?? null },
      create: { tenantId, rotationId, dayOffset: dto.dayOffset, shiftId: dto.shiftId ?? null },
    });

    this.eventEmitter.emit('shift.rotation_slot_updated', { tenantId, rotationId, dayOffset: dto.dayOffset, actorId });
    return slot;
  }

  // ─── Attendance Integration ───────────────────────────────────────────────

  async getEffectiveShift(tenantId: string, userId: string, date: Date): Promise<EffectiveShift | null> {
    const targetDate = startOfDay(date);

    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: {
        tenantId,
        userId,
        isActive: true,
        startDate: { lte: targetDate },
        OR: [{ endDate: null }, { endDate: { gte: targetDate } }],
      },
      orderBy: { startDate: 'desc' },
      include: {
        shift: { include: { breakRules: { orderBy: { startOffsetMins: 'asc' } } } },
        rotation: {
          include: {
            slots: {
              include: { shift: { include: { breakRules: { orderBy: { startOffsetMins: 'asc' } } } } },
            },
          },
        },
      },
    });

    if (!assignment) return null;

    let shift = assignment.shift;

    if (!shift && assignment.rotation) {
      const resolvedShiftId = this.resolveRotationShift(assignment.rotation, targetDate);
      if (!resolvedShiftId) return null; // day off in rotation

      const slot = assignment.rotation.slots.find((s) => s.shiftId === resolvedShiftId);
      shift = slot?.shift ?? null;
    }

    if (!shift) return null;

    // Respect shift's configured work days
    const isoDay = getISODay(targetDate);
    if (!shift.workDays.includes(isoDay)) return null;

    const scheduledIn = this.buildShiftDateTime(shift.startTime, targetDate, false);
    const scheduledOut = this.buildShiftDateTime(shift.endTime, targetDate, shift.isNightShift);

    return {
      shiftId: shift.id,
      shiftName: shift.name,
      scheduledIn,
      scheduledOut,
      graceMinutes: shift.graceMinutes,
      overtimeAfterMinutes: shift.overtimeAfterMinutes ?? null,
      isNightShift: shift.isNightShift,
      breakRules: shift.breakRules.map((r) => ({
        id: r.id,
        name: r.name,
        breakType: r.breakType,
        startOffsetMins: r.startOffsetMins,
        durationMinutes: r.durationMinutes,
        isPaid: r.isPaid,
        isRequired: r.isRequired,
      })),
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  buildShiftDateTime(timeStr: string, date: Date, addDay: boolean): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const base = addDay ? addDays(startOfDay(date), 1) : startOfDay(date);
    return set(base, { hours, minutes, seconds: 0, milliseconds: 0 });
  }

  private resolveRotationShift(
    rotation: { cycleDays: number; startDate: Date; slots: { dayOffset: number; shiftId: string | null }[] },
    date: Date,
  ): string | null {
    const diffDays = differenceInDays(startOfDay(date), startOfDay(rotation.startDate));
    const cycleDay = ((diffDays % rotation.cycleDays) + rotation.cycleDays) % rotation.cycleDays;
    const slot = rotation.slots.find((s) => s.dayOffset === cycleDay);
    return slot?.shiftId ?? null;
  }

  private shiftKey(tenantId: string, shiftId: string): string {
    return this.redis.buildTenantKey(tenantId, 'shift', shiftId);
  }

  private async writeAuditLog(
    tenantId: string,
    actorId: string,
    action: AuditAction,
    resource: string,
    resourceId: string,
    oldValues: unknown,
    newValues: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId,
          userId: actorId,
          action,
          resource,
          resourceId,
          oldValues: oldValues as Prisma.InputJsonValue,
          newValues: newValues as Prisma.InputJsonValue,
          status: AuditStatus.SUCCESS,
        },
      });
    } catch (err) {
      this.logger.error(`Audit log write failed for ${resource}/${resourceId}: ${err}`);
    }
  }
}
