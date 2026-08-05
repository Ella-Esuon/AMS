import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, LeaveRequestStatus, AuditAction, AuditStatus } from '@prisma/client';
import { eachDayOfInterval, isWeekend, parseISO, startOfDay, endOfDay } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { QueryLeaveTypeDto } from './dto/query-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';
import { QueryLeaveRequestDto } from './dto/query-leave-request.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-balance.dto';
import { buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';
import { AttendanceService } from '../attendance/attendance.service';

const LEAVE_REQUEST_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  isHalfDay: true,
  totalDays: true,
  reason: true,
  status: true,
  reviewedBy: true,
  reviewedAt: true,
  rejectionReason: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, firstName: true, lastName: true, employeeId: true, email: true },
  },
  leaveType: {
    select: { id: true, name: true, code: true, isPaid: true, colorCode: true },
  },
};

type LeaveRequestPayload = Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_REQUEST_SELECT }>;
type LeaveBalanceRow = { allocatedDays: Prisma.Decimal; usedDays: Prisma.Decimal; carriedOverDays: Prisma.Decimal };

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly attendanceService?: AttendanceService,
  ) {}

  // ─── Leave Types ──────────────────────────────────────────────────────────

  async createLeaveType(tenantId: string, dto: CreateLeaveTypeDto, actorId: string) {
    if (dto.code) {
      const existing = await this.prisma.leaveType.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null },
      });
      if (existing) throw new ConflictException(`Leave type with code '${dto.code}' already exists.`);
    }

    const leaveType = await this.prisma.leaveType.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code ?? null,
        description: dto.description ?? null,
        isPaid: dto.isPaid ?? true,
        defaultDaysPerYear: dto.defaultDaysPerYear ?? 0,
        requiresApproval: dto.requiresApproval ?? true,
        colorCode: dto.colorCode ?? null,
      },
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.CREATE, 'leave_type', leaveType.id, null, leaveType);
    this.eventEmitter.emit('leave_type.created', { tenantId, leaveTypeId: leaveType.id, actorId });

    return leaveType;
  }

  async findAllLeaveTypes(tenantId: string, query: QueryLeaveTypeDto) {
    const { page, limit, isActive, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where: Prisma.LeaveTypeWhereInput = {
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

    const [leaveTypes, total] = await Promise.all([
      this.prisma.leaveType.findMany({ where, skip, take, orderBy: { [sortBy]: sortOrder } }),
      this.prisma.leaveType.count({ where }),
    ]);

    return { nodes: leaveTypes, meta: buildPaginationMeta(total, page, limit) };
  }

  async findLeaveType(tenantId: string, id: string) {
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!leaveType) throw new NotFoundException('Leave type not found');
    return leaveType;
  }

  async updateLeaveType(tenantId: string, id: string, dto: UpdateLeaveTypeDto, actorId: string) {
    await this.findLeaveType(tenantId, id);

    if (dto.code) {
      const conflict = await this.prisma.leaveType.findFirst({
        where: { tenantId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`Leave type with code '${dto.code}' already exists.`);
    }

    const leaveType = await this.prisma.leaveType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPaid !== undefined && { isPaid: dto.isPaid }),
        ...(dto.defaultDaysPerYear !== undefined && { defaultDaysPerYear: dto.defaultDaysPerYear }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.colorCode !== undefined && { colorCode: dto.colorCode }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.UPDATE, 'leave_type', id, null, dto);
    this.eventEmitter.emit('leave_type.updated', { tenantId, leaveTypeId: id, actorId, changes: dto });

    return leaveType;
  }

  async removeLeaveType(tenantId: string, id: string, actorId: string) {
    await this.findLeaveType(tenantId, id);

    await this.prisma.leaveType.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.DELETE, 'leave_type', id, null, null);
    this.eventEmitter.emit('leave_type.deleted', { tenantId, leaveTypeId: id, actorId });

    return { success: true };
  }

  // ─── Leave Balances ───────────────────────────────────────────────────────

  async getMyBalances(tenantId: string, userId: string, year?: number) {
    const targetYear = year ?? new Date().getFullYear();

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { tenantId, isActive: true, deletedAt: null, defaultDaysPerYear: { gt: 0 } },
    });

    const balances = await Promise.all(
      leaveTypes.map((lt) => this.getOrCreateBalance(tenantId, userId, lt.id, targetYear)),
    );

    return balances.map((b) => this.normalizeBalance(b));
  }

  async adjustBalance(tenantId: string, dto: AdjustLeaveBalanceDto, actorId: string) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, deletedAt: null },
    });
    if (!leaveType) throw new NotFoundException('Leave type not found');

    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    const balance = await this.prisma.leaveBalance.upsert({
      where: {
        tenantId_userId_leaveTypeId_year: {
          tenantId,
          userId: dto.userId,
          leaveTypeId: dto.leaveTypeId,
          year: dto.year,
        },
      },
      update: {
        ...(dto.allocatedDays !== undefined && { allocatedDays: dto.allocatedDays }),
        ...(dto.carriedOverDays !== undefined && { carriedOverDays: dto.carriedOverDays }),
      },
      create: {
        tenantId,
        userId: dto.userId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        allocatedDays: dto.allocatedDays ?? leaveType.defaultDaysPerYear,
        carriedOverDays: dto.carriedOverDays ?? 0,
      },
    });

    await this.writeAuditLog(tenantId, actorId, AuditAction.UPDATE, 'leave_balance', balance.id, null, dto);
    this.eventEmitter.emit('leave.balance_adjusted', {
      tenantId,
      userId: dto.userId,
      leaveTypeId: dto.leaveTypeId,
      actorId,
    });

    return this.normalizeBalance(balance);
  }

  // ─── Leave Requests ───────────────────────────────────────────────────────

  async submitRequest(tenantId: string, userId: string, dto: CreateLeaveRequestDto) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, isActive: true, deletedAt: null },
    });
    if (!leaveType) throw new NotFoundException('Leave type not found or inactive');

    const startDate = startOfDay(parseISO(dto.startDate));
    const endDate = startOfDay(parseISO(dto.endDate));

    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate.');
    }
    if (startDate.getFullYear() !== endDate.getFullYear()) {
      throw new BadRequestException('Leave requests cannot span more than one calendar year.');
    }
    if (dto.isHalfDay && startDate.getTime() !== endDate.getTime()) {
      throw new BadRequestException('Half-day leave requires startDate to equal endDate.');
    }

    const totalDays = this.computeTotalDays(startDate, endDate, !!dto.isHalfDay);
    if (totalDays <= 0) {
      throw new BadRequestException('Selected date range contains no working days.');
    }

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        tenantId,
        userId,
        status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      throw new ConflictException('You already have a leave request that overlaps these dates.');
    }

    const year = startDate.getFullYear();
    if (leaveType.defaultDaysPerYear > 0) {
      const balance = await this.getOrCreateBalance(tenantId, userId, leaveType.id, year);
      const available = this.availableDays(balance);
      if (available < totalDays) {
        throw new BadRequestException(
          `Insufficient leave balance: ${available} day(s) available, ${totalDays} requested.`,
        );
      }
    }

    const initialStatus = leaveType.requiresApproval ? LeaveRequestStatus.PENDING : LeaveRequestStatus.APPROVED;

    const request = await this.prisma.leaveRequest.create({
      data: {
        tenantId,
        userId,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        isHalfDay: !!dto.isHalfDay,
        totalDays,
        reason: dto.reason ?? null,
        status: initialStatus,
        ...(initialStatus === LeaveRequestStatus.APPROVED && { reviewedBy: userId, reviewedAt: new Date() }),
      },
      select: LEAVE_REQUEST_SELECT,
    });

    if (initialStatus === LeaveRequestStatus.APPROVED) {
      await this.applyApprovalEffects(tenantId, request, year);
    }

    await this.writeAuditLog(tenantId, userId, AuditAction.CREATE, 'leave_request', request.id, null, {
      status: initialStatus,
      totalDays,
    });

    this.eventEmitter.emit('leave.requested', { tenantId, userId, requestId: request.id, status: initialStatus });
    if (initialStatus === LeaveRequestStatus.APPROVED) {
      this.eventEmitter.emit('leave.approved', { tenantId, userId, requestId: request.id, autoApproved: true });
    }

    this.logger.log(`Leave request created: user=${userId} tenant=${tenantId} status=${initialStatus}`);

    return this.normalizeRequest(request);
  }

  async findAllRequests(tenantId: string, query: QueryLeaveRequestDto) {
    const {
      page, limit, userId, leaveTypeId, status, startDate, endDate,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where: Prisma.LeaveRequestWhereInput = {
      tenantId,
      ...(userId && { userId }),
      ...(leaveTypeId && { leaveTypeId }),
      ...(status && { status }),
      ...(startDate && { endDate: { gte: startOfDay(parseISO(startDate)) } }),
      ...(endDate && { startDate: { lte: endOfDay(parseISO(endDate)) } }),
    };

    const [requests, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        select: LEAVE_REQUEST_SELECT,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return {
      nodes: requests.map((r) => this.normalizeRequest(r)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findMyRequests(tenantId: string, userId: string, query: QueryLeaveRequestDto) {
    return this.findAllRequests(tenantId, { ...query, userId });
  }

  async findOneRequest(tenantId: string, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({ where: { id, tenantId }, select: LEAVE_REQUEST_SELECT });
    if (!request) throw new NotFoundException('Leave request not found');
    return this.normalizeRequest(request);
  }

  async reviewRequest(tenantId: string, requestId: string, dto: ReviewLeaveRequestDto, actorId: string) {
    const existing = await this.prisma.leaveRequest.findFirst({ where: { id: requestId, tenantId } });
    if (!existing) throw new NotFoundException('Leave request not found');
    if (existing.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException('Only pending leave requests can be reviewed.');
    }

    if (dto.decision === LeaveRequestStatus.APPROVED) {
      const leaveType = await this.prisma.leaveType.findFirst({ where: { id: existing.leaveTypeId, tenantId } });
      if (leaveType && leaveType.defaultDaysPerYear > 0) {
        const year = existing.startDate.getFullYear();
        const balance = await this.getOrCreateBalance(tenantId, existing.userId, existing.leaveTypeId, year);
        const available = this.availableDays(balance);
        const requested = Number(existing.totalDays);
        if (available < requested) {
          throw new BadRequestException(
            `Insufficient leave balance to approve: ${available} day(s) available, ${requested} requested.`,
          );
        }
      }
    }

    const request = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: dto.decision,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        ...(dto.decision === LeaveRequestStatus.REJECTED && { rejectionReason: dto.rejectionReason ?? null }),
      },
      select: LEAVE_REQUEST_SELECT,
    });

    if (dto.decision === LeaveRequestStatus.APPROVED) {
      await this.applyApprovalEffects(tenantId, request, existing.startDate.getFullYear());
    }

    await this.writeAuditLog(
      tenantId,
      actorId,
      AuditAction.UPDATE,
      'leave_request',
      requestId,
      { status: existing.status },
      { status: dto.decision },
    );
    this.eventEmitter.emit(dto.decision === LeaveRequestStatus.APPROVED ? 'leave.approved' : 'leave.rejected', {
      tenantId,
      requestId,
      actorId,
      userId: existing.userId,
    });

    return this.normalizeRequest(request);
  }

  async cancelOwnRequest(tenantId: string, requestId: string, userId: string) {
    const existing = await this.prisma.leaveRequest.findFirst({ where: { id: requestId, tenantId, userId } });
    if (!existing) throw new NotFoundException('Leave request not found');
    if (existing.status !== LeaveRequestStatus.PENDING) {
      throw new ConflictException(
        'Only pending leave requests can be cancelled. Contact HR to cancel an approved request.',
      );
    }

    const request = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: LeaveRequestStatus.CANCELLED, cancelledAt: new Date() },
      select: LEAVE_REQUEST_SELECT,
    });

    this.eventEmitter.emit('leave.cancelled', { tenantId, requestId, userId, actorId: userId });
    return this.normalizeRequest(request);
  }

  async cancelRequest(tenantId: string, requestId: string, actorId: string) {
    const existing = await this.prisma.leaveRequest.findFirst({ where: { id: requestId, tenantId } });
    if (!existing) throw new NotFoundException('Leave request not found');
    if (existing.status !== LeaveRequestStatus.PENDING && existing.status !== LeaveRequestStatus.APPROVED) {
      throw new ConflictException('Only pending or approved leave requests can be cancelled.');
    }

    if (existing.status === LeaveRequestStatus.APPROVED) {
      await this.reverseApprovalEffects(tenantId, existing);
    }

    const request = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: LeaveRequestStatus.CANCELLED, cancelledAt: new Date() },
      select: LEAVE_REQUEST_SELECT,
    });

    await this.writeAuditLog(
      tenantId,
      actorId,
      AuditAction.UPDATE,
      'leave_request',
      requestId,
      { status: existing.status },
      { status: LeaveRequestStatus.CANCELLED },
    );
    this.eventEmitter.emit('leave.cancelled', { tenantId, requestId, userId: existing.userId, actorId });

    return this.normalizeRequest(request);
  }

  // ─── Private: Approval Side Effects ───────────────────────────────────────

  private async applyApprovalEffects(
    tenantId: string,
    request: { userId: string; leaveTypeId: string; startDate: Date; endDate: Date; totalDays: Prisma.Decimal },
    year: number,
  ): Promise<void> {
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id: request.leaveTypeId, tenantId } });
    if (leaveType && leaveType.defaultDaysPerYear > 0) {
      await this.getOrCreateBalance(tenantId, request.userId, request.leaveTypeId, year);
      await this.prisma.leaveBalance.update({
        where: {
          tenantId_userId_leaveTypeId_year: {
            tenantId,
            userId: request.userId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
        data: { usedDays: { increment: request.totalDays } },
      });
    }

    await this.markAttendanceForRange(tenantId, request.userId, request.startDate, request.endDate, true);
  }

  private async reverseApprovalEffects(
    tenantId: string,
    request: { userId: string; leaveTypeId: string; startDate: Date; endDate: Date; totalDays: Prisma.Decimal },
  ): Promise<void> {
    const year = request.startDate.getFullYear();
    const leaveType = await this.prisma.leaveType.findFirst({ where: { id: request.leaveTypeId, tenantId } });
    if (leaveType && leaveType.defaultDaysPerYear > 0) {
      await this.prisma.leaveBalance.updateMany({
        where: { tenantId, userId: request.userId, leaveTypeId: request.leaveTypeId, year },
        data: { usedDays: { decrement: request.totalDays } },
      });
    }

    await this.markAttendanceForRange(tenantId, request.userId, request.startDate, request.endDate, false);
  }

  private async markAttendanceForRange(
    tenantId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
    onLeave: boolean,
  ): Promise<void> {
    if (!this.attendanceService) return;

    for (const day of this.enumerateBusinessDays(startDate, endDate)) {
      try {
        await this.attendanceService.setLeaveStatus(tenantId, userId, day, onLeave);
      } catch (err) {
        this.logger.error(`Failed to sync attendance for leave (user=${userId} day=${day.toISOString()}): ${err}`);
      }
    }
  }

  // ─── Private: Balance Helpers ──────────────────────────────────────────────

  private async getOrCreateBalance(tenantId: string, userId: string, leaveTypeId: string, year: number) {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { tenantId_userId_leaveTypeId_year: { tenantId, userId, leaveTypeId, year } },
    });
    if (existing) return existing;

    const leaveType = await this.prisma.leaveType.findFirst({ where: { id: leaveTypeId, tenantId } });
    return this.prisma.leaveBalance.create({
      data: { tenantId, userId, leaveTypeId, year, allocatedDays: leaveType?.defaultDaysPerYear ?? 0 },
    });
  }

  private availableDays(balance: LeaveBalanceRow): number {
    return Number(balance.allocatedDays) + Number(balance.carriedOverDays) - Number(balance.usedDays);
  }

  private normalizeBalance(balance: LeaveBalanceRow & Record<string, unknown>) {
    return {
      ...balance,
      allocatedDays: Number(balance.allocatedDays),
      usedDays: Number(balance.usedDays),
      carriedOverDays: Number(balance.carriedOverDays),
      availableDays: this.availableDays(balance),
    };
  }

  // ─── Private: Date Helpers ──────────────────────────────────────────────────

  private computeTotalDays(startDate: Date, endDate: Date, isHalfDay: boolean): number {
    if (isHalfDay) return 0.5;
    return this.enumerateBusinessDays(startDate, endDate).length;
  }

  private enumerateBusinessDays(startDate: Date, endDate: Date): Date[] {
    return eachDayOfInterval({ start: startDate, end: endDate }).filter((d) => !isWeekend(d));
  }

  // ─── Private: Serialization ──────────────────────────────────────────────

  private normalizeRequest(request: LeaveRequestPayload) {
    return { ...request, totalDays: Number(request.totalDays) };
  }

  // ─── Private: Audit Log ───────────────────────────────────────────────────

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
