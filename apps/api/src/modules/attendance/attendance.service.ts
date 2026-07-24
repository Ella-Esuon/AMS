import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, AttendanceStatus, ClockMethod, BreakType, AuditAction, AuditStatus } from '@prisma/client';
import { differenceInMinutes, startOfDay, endOfDay, parseISO } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { ClockInDto, StartBreakDto } from './dto/clock-in.dto';
import { ClockOutDto, EndBreakDto, UpdateAttendanceDto, ManualEntryDto } from './dto/clock-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import { ActiveSession } from './types/attendance.types';
import { buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';
import { ShiftsService } from '../shifts/shifts.service';

const SESSION_TTL = 86400;   // 24 hours — covers overnight shifts
const BREAK_TTL = 14400;     // 4 hours max break
const POLICY_CACHE_TTL = 300; // 5 minutes

const ATTENDANCE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  shiftId: true,
  locationId: true,
  date: true,
  scheduledIn: true,
  scheduledOut: true,
  clockIn: true,
  clockOut: true,
  clockInMethod: true,
  clockOutMethod: true,
  clockInLat: true,
  clockInLng: true,
  clockOutLat: true,
  clockOutLng: true,
  clockInDevice: true,
  clockOutDevice: true,
  clockInIp: true,
  clockOutIp: true,
  status: true,
  workMinutes: true,
  overtimeMinutes: true,
  breakMinutes: true,
  isLate: true,
  lateMinutes: true,
  isEarlyDeparture: true,
  earlyMinutes: true,
  isManualEntry: true,
  manualEntryBy: true,
  notes: true,
  approvalStatus: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  breaks: {
    orderBy: { startTime: 'asc' as const },
  },
  user: {
    select: { id: true, firstName: true, lastName: true, employeeId: true, email: true },
  },
};

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly shiftsService?: ShiftsService,
  ) {}

  // ─── Clock In ─────────────────────────────────────────────────────────────

  async clockIn(
    tenantId: string,
    userId: string,
    dto: ClockInDto,
    ipAddress?: string,
    _userAgent?: string,
  ) {
    // Prevent duplicate clock-in
    const existingSession = await this.getActiveSessionFromCache(tenantId, userId);
    if (existingSession) {
      throw new ConflictException('Already clocked in. Please clock out before clocking in again.');
    }

    // Fallback check in DB (handles Redis eviction edge case)
    const today = startOfDay(new Date());
    const dbActive = await this.prisma.attendanceRecord.findFirst({
      where: {
        tenantId,
        userId,
        date: today,
        clockIn: { not: null },
        clockOut: null,
      },
    });
    if (dbActive) {
      await this.cacheActiveSession(tenantId, userId, {
        recordId: dbActive.id,
        clockIn: dbActive.clockIn!.toISOString(),
        date: dbActive.date.toISOString(),
      });
      throw new ConflictException('Already clocked in. Please clock out before clocking in again.');
    }

    const policy = await this.getOrCreatePolicy(tenantId);

    // Validate clock method is allowed
    if (dto.method && !policy.allowedMethods.includes(dto.method)) {
      throw new ForbiddenException(`Clock method '${dto.method}' is not allowed by your organisation's policy.`);
    }

    // GPS validation
    if (policy.requireGpsLocation) {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException('GPS location is required for clock-in at this organisation.');
      }
      await this.assertWithinAllowedLocation(
        tenantId,
        dto.latitude,
        dto.longitude,
        dto.locationId,
        policy.gpsRadiusMeters,
      );
    }

    const now = new Date();

    // Resolve effective shift for today — gracefully skipped if ShiftsModule is not loaded
    const effectiveShift = this.shiftsService
      ? await this.shiftsService.getEffectiveShift(tenantId, userId, today).catch(() => null)
      : null;

    const effectiveGrace = (effectiveShift && effectiveShift.graceMinutes > 0)
      ? effectiveShift.graceMinutes
      : policy.graceMinutes;

    const { isLate, lateMinutes } = this.detectLate(now, effectiveShift?.scheduledIn ?? null, effectiveGrace);

    const record = await this.prisma.attendanceRecord.upsert({
      where: { tenantId_userId_date: { tenantId, userId, date: today } },
      update: {
        clockIn: now,
        clockInMethod: dto.method ?? ClockMethod.MANUAL,
        clockInLat: dto.latitude ?? null,
        clockInLng: dto.longitude ?? null,
        clockInDevice: dto.deviceId ?? null,
        clockInIp: ipAddress ?? null,
        locationId: dto.locationId ?? undefined,
        shiftId: effectiveShift?.shiftId ?? null,
        scheduledIn: effectiveShift?.scheduledIn ?? null,
        scheduledOut: effectiveShift?.scheduledOut ?? null,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        isLate,
        lateMinutes,
        clockOut: null,
        workMinutes: null,
        notes: dto.notes ?? undefined,
      },
      create: {
        tenantId,
        userId,
        date: today,
        locationId: dto.locationId ?? null,
        shiftId: effectiveShift?.shiftId ?? null,
        scheduledIn: effectiveShift?.scheduledIn ?? null,
        scheduledOut: effectiveShift?.scheduledOut ?? null,
        clockIn: now,
        clockInMethod: dto.method ?? ClockMethod.MANUAL,
        clockInLat: dto.latitude ?? null,
        clockInLng: dto.longitude ?? null,
        clockInDevice: dto.deviceId ?? null,
        clockInIp: ipAddress ?? null,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        isLate,
        lateMinutes,
        notes: dto.notes ?? null,
      },
      select: ATTENDANCE_SELECT,
    });

    await this.cacheActiveSession(tenantId, userId, {
      recordId: record.id,
      clockIn: now.toISOString(),
      date: today.toISOString(),
    });

    await this.writeAuditLog(
      tenantId,
      userId,
      userId,
      AuditAction.CREATE,
      'attendance',
      record.id,
      null,
      { clockIn: now, status: record.status },
      ipAddress,
    );

    this.eventEmitter.emit('attendance.clocked_in', {
      tenantId,
      userId,
      recordId: record.id,
      clockIn: now,
      isLate,
      lateMinutes,
      method: dto.method ?? ClockMethod.MANUAL,
      locationId: dto.locationId,
    });

    if (isLate) {
      this.eventEmitter.emit('attendance.late', { tenantId, userId, recordId: record.id, lateMinutes });
    }

    this.logger.log(
      `Clock-in: user=${userId} tenant=${tenantId} late=${isLate} lateMin=${lateMinutes}`,
    );

    return this.normalizeRecord(record);
  }

  // ─── Clock Out ────────────────────────────────────────────────────────────

  async clockOut(
    tenantId: string,
    userId: string,
    dto: ClockOutDto,
    ipAddress?: string,
    _userAgent?: string,
  ) {
    const session = await this.getActiveSessionFromCache(tenantId, userId);
    if (!session) {
      // Last-resort DB lookup (Redis miss after restart)
      const today = startOfDay(new Date());
      const dbRecord = await this.prisma.attendanceRecord.findFirst({
        where: { tenantId, userId, date: today, clockIn: { not: null }, clockOut: null },
      });
      if (!dbRecord) {
        throw new BadRequestException('No active clock-in session found. Please clock in first.');
      }
      // Re-hydrate the session so the rest of the flow works
      return this.performClockOut(tenantId, userId, dbRecord.id, dto, ipAddress);
    }

    return this.performClockOut(tenantId, userId, session.recordId, dto, ipAddress);
  }

  private async performClockOut(
    tenantId: string,
    userId: string,
    recordId: string,
    dto: ClockOutDto,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.attendanceRecord.findFirst({
      where: { id: recordId, tenantId },
      include: { breaks: true },
    });
    if (!existing || !existing.clockIn) {
      throw new BadRequestException('Attendance record not found or not clocked in.');
    }
    if (existing.clockOut) {
      throw new ConflictException('Already clocked out for today.');
    }

    // End any open break automatically
    const openBreak = existing.breaks.find((b) => !b.endTime);
    if (openBreak) {
      await this.closeBreak(openBreak.id, tenantId, new Date());
      await this.clearActiveBreak(tenantId, userId);
    }

    const now = new Date();
    const policy = await this.getOrCreatePolicy(tenantId);

    // Re-fetch breakMinutes after potentially closing a break
    const updatedBreaks = await this.prisma.attendanceBreak.findMany({
      where: { attendanceId: recordId },
    });
    const totalBreakMinutes = updatedBreaks.reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);

    // Use shift-level overtime threshold when available, fall back to policy
    let effectiveOvertimeAfter = policy.overtimeAfterMinutes;
    if (existing.shiftId && this.shiftsService) {
      const shiftData = await this.shiftsService.findOne(tenantId, existing.shiftId).catch(() => null) as any;
      if (shiftData?.overtimeAfterMinutes != null) {
        effectiveOvertimeAfter = shiftData.overtimeAfterMinutes;
      }
    }

    const { workMinutes, overtimeMinutes } = this.calculateWorkDuration(
      existing.clockIn,
      now,
      totalBreakMinutes,
      effectiveOvertimeAfter,
    );

    const { isEarlyDeparture, earlyMinutes } = this.detectEarlyDeparture(
      now,
      existing.scheduledOut,
      policy.graceMinutes,
    );

    let status = existing.status;
    if (isEarlyDeparture && status === AttendanceStatus.PRESENT) {
      status = AttendanceStatus.EARLY_DEPARTURE;
    }
    if (overtimeMinutes > 0 && status === AttendanceStatus.PRESENT) {
      status = AttendanceStatus.OVERTIME;
    }

    const record = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        clockOut: now,
        clockOutMethod: dto.method ?? ClockMethod.MANUAL,
        clockOutLat: dto.latitude ?? null,
        clockOutLng: dto.longitude ?? null,
        clockOutDevice: dto.deviceId ?? null,
        clockOutIp: ipAddress ?? null,
        workMinutes,
        overtimeMinutes,
        breakMinutes: totalBreakMinutes,
        isEarlyDeparture,
        earlyMinutes,
        status,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
      select: ATTENDANCE_SELECT,
    });

    await this.clearActiveSession(tenantId, userId);

    await this.writeAuditLog(
      tenantId,
      userId,
      userId,
      AuditAction.UPDATE,
      'attendance',
      recordId,
      { clockOut: null },
      { clockOut: now, workMinutes, overtimeMinutes },
      ipAddress,
    );

    this.eventEmitter.emit('attendance.clocked_out', {
      tenantId,
      userId,
      recordId: record.id,
      clockOut: now,
      workMinutes,
      overtimeMinutes,
      isEarlyDeparture,
    });

    if (overtimeMinutes > 0) {
      this.eventEmitter.emit('attendance.overtime', { tenantId, userId, recordId: record.id, overtimeMinutes });
    }

    this.logger.log(
      `Clock-out: user=${userId} tenant=${tenantId} workMin=${workMinutes} otMin=${overtimeMinutes}`,
    );

    return this.normalizeRecord(record);
  }

  // ─── Break Start ──────────────────────────────────────────────────────────

  async startBreak(tenantId: string, userId: string, dto: StartBreakDto) {
    const session = await this.getActiveSessionFromCache(tenantId, userId);
    if (!session) {
      throw new BadRequestException('You must be clocked in to start a break.');
    }

    const existingBreak = await this.getActiveBreakFromCache(tenantId, userId);
    if (existingBreak) {
      throw new ConflictException('You are already on a break. End the current break first.');
    }

    const policy = await this.getOrCreatePolicy(tenantId);
    const now = new Date();

    // Validate max break duration policy (warn via event, don't block)
    const todayBreaks = await this.prisma.attendanceBreak.findMany({
      where: { attendanceId: session.recordId },
    });
    const usedBreakMinutes = todayBreaks.reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);
    if (policy.maxBreakMinutes > 0 && usedBreakMinutes >= policy.maxBreakMinutes) {
      throw new ForbiddenException(
        `Maximum break time of ${policy.maxBreakMinutes} minutes reached for today.`,
      );
    }

    const attendanceBreak = await this.prisma.attendanceBreak.create({
      data: {
        tenantId,
        attendanceId: session.recordId,
        breakType: dto.breakType ?? BreakType.SHORT_BREAK,
        startTime: now,
        notes: dto.notes ?? null,
      },
    });

    await this.cacheActiveBreak(tenantId, userId, {
      recordId: session.recordId,
      clockIn: session.clockIn,
      date: session.date,
      activeBreakId: attendanceBreak.id,
      breakStartTime: now.toISOString(),
      breakType: attendanceBreak.breakType,
    });

    this.eventEmitter.emit('attendance.break_started', {
      tenantId,
      userId,
      recordId: session.recordId,
      breakId: attendanceBreak.id,
      breakType: attendanceBreak.breakType,
      startTime: now,
    });

    return attendanceBreak;
  }

  // ─── Break End ────────────────────────────────────────────────────────────

  async endBreak(tenantId: string, userId: string, dto: EndBreakDto) {
    const session = await this.getActiveBreakFromCache(tenantId, userId);
    if (!session?.activeBreakId) {
      // Fallback: check DB for open break on today's record
      const today = startOfDay(new Date());
      const record = await this.prisma.attendanceRecord.findFirst({
        where: { tenantId, userId, date: today },
        include: { breaks: { where: { endTime: null } } },
      });
      const openBreak = record?.breaks[0];
      if (!openBreak) {
        throw new BadRequestException('No active break found. Please start a break first.');
      }
      return this.performEndBreak(tenantId, userId, openBreak.id, dto);
    }

    return this.performEndBreak(tenantId, userId, session.activeBreakId, dto);
  }

  private async performEndBreak(
    tenantId: string,
    userId: string,
    breakId: string,
    dto: EndBreakDto,
  ) {
    const attendanceBreak = await this.prisma.attendanceBreak.findFirst({
      where: { id: breakId, tenantId, endTime: null },
    });
    if (!attendanceBreak) {
      throw new NotFoundException('Break record not found or already ended.');
    }

    const now = new Date();
    const durationMinutes = differenceInMinutes(now, attendanceBreak.startTime);

    const updated = await this.prisma.attendanceBreak.update({
      where: { id: breakId },
      data: {
        endTime: now,
        durationMinutes,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });

    // Update total breakMinutes on the attendance record
    const allBreaks = await this.prisma.attendanceBreak.findMany({
      where: { attendanceId: attendanceBreak.attendanceId },
    });
    const totalBreakMinutes = allBreaks.reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);

    await this.prisma.attendanceRecord.update({
      where: { id: attendanceBreak.attendanceId },
      data: { breakMinutes: totalBreakMinutes },
    });

    await this.clearActiveBreak(tenantId, userId);

    this.eventEmitter.emit('attendance.break_ended', {
      tenantId,
      userId,
      recordId: attendanceBreak.attendanceId,
      breakId,
      durationMinutes,
    });

    return updated;
  }

  // ─── Active Session ───────────────────────────────────────────────────────

  async getActiveSession(tenantId: string, userId: string): Promise<ActiveSession | null> {
    const session = await this.getActiveBreakFromCache(tenantId, userId)
      ?? await this.getActiveSessionFromCache(tenantId, userId);
    if (session) return session;

    // Rebuild from DB
    const today = startOfDay(new Date());
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { tenantId, userId, date: today, clockIn: { not: null }, clockOut: null },
      include: { breaks: { where: { endTime: null } } },
    });
    if (!record) return null;

    const openBreak = record.breaks[0];
    const session2: ActiveSession = {
      recordId: record.id,
      clockIn: record.clockIn!.toISOString(),
      date: record.date.toISOString(),
      ...(openBreak && {
        activeBreakId: openBreak.id,
        breakStartTime: openBreak.startTime.toISOString(),
        breakType: openBreak.breakType,
      }),
    };

    await this.cacheActiveSession(tenantId, userId, session2);
    return session2;
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, query: QueryAttendanceDto) {
    const {
      page, limit, userId, departmentId, locationId, status,
      startDate, endDate, isLate, isManualEntry,
      sortBy = 'date', sortOrder = 'desc',
    } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where: Prisma.AttendanceRecordWhereInput = {
      tenantId,
      ...(userId && { userId }),
      ...(locationId && { locationId }),
      ...(status && { status }),
      ...(isLate !== undefined && { isLate }),
      ...(isManualEntry !== undefined && { isManualEntry }),
      ...(departmentId && { user: { departmentId } }),
      ...((startDate || endDate) && {
        date: {
          ...(startDate && { gte: startOfDay(parseISO(startDate)) }),
          ...(endDate && { lte: endOfDay(parseISO(endDate)) }),
        },
      }),
    };

    const [records, total] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where,
        select: ATTENDANCE_SELECT,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);

    return {
      nodes: records.map(this.normalizeRecord),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id, tenantId },
      select: ATTENDANCE_SELECT,
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return this.normalizeRecord(record);
  }

  async findByUser(tenantId: string, userId: string, query: QueryAttendanceDto) {
    return this.findAll(tenantId, { ...query, userId });
  }

  async getDailySummary(tenantId: string, date: string) {
    const targetDate = parseISO(date);

    const [total, present, absent, late, onLeave, earlyDeparture, halfDay, overtime] =
      await Promise.all([
        this.prisma.user.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.PRESENT },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.ABSENT },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.LATE },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.ON_LEAVE },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.EARLY_DEPARTURE },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.HALF_DAY },
        }),
        this.prisma.attendanceRecord.count({
          where: { tenantId, date: startOfDay(targetDate), status: AttendanceStatus.OVERTIME },
        }),
      ]);

    return {
      date,
      total,
      present,
      absent,
      late,
      onLeave,
      earlyDeparture,
      halfDay,
      overtime,
    };
  }

  // ─── Manual Entry ─────────────────────────────────────────────────────────

  async createManualEntry(tenantId: string, dto: ManualEntryDto, actorId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const date = startOfDay(parseISO(dto.date));
    const clockIn = dto.clockIn ? new Date(dto.clockIn) : null;
    const clockOut = dto.clockOut ? new Date(dto.clockOut) : null;

    if (clockIn && clockOut && clockOut <= clockIn) {
      throw new BadRequestException('Clock-out time must be after clock-in time.');
    }

    const policy = await this.getOrCreatePolicy(tenantId);
    let workMinutes: number | null = null;
    let overtimeMinutes: number | null = null;
    let isLate = false;
    let lateMinutes = 0;

    if (clockIn && clockOut) {
      const calc = this.calculateWorkDuration(clockIn, clockOut, 0, policy.overtimeAfterMinutes);
      workMinutes = calc.workMinutes;
      overtimeMinutes = calc.overtimeMinutes;
    }
    if (clockIn) {
      const late = this.detectLate(clockIn, null, policy.graceMinutes);
      isLate = late.isLate;
      lateMinutes = late.lateMinutes;
    }

    const status = dto.status ?? (isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT);

    const record = await this.prisma.attendanceRecord.upsert({
      where: { tenantId_userId_date: { tenantId, userId: dto.userId, date } },
      update: {
        clockIn,
        clockOut,
        status,
        isLate,
        lateMinutes,
        workMinutes,
        overtimeMinutes,
        isManualEntry: true,
        manualEntryBy: actorId,
        notes: dto.notes ?? undefined,
      },
      create: {
        tenantId,
        userId: dto.userId,
        date,
        clockIn,
        clockOut,
        status,
        isLate,
        lateMinutes,
        workMinutes,
        overtimeMinutes,
        isManualEntry: true,
        manualEntryBy: actorId,
        notes: dto.notes ?? null,
      },
      select: ATTENDANCE_SELECT,
    });

    await this.writeAuditLog(
      tenantId,
      dto.userId,
      actorId,
      AuditAction.CREATE,
      'attendance',
      record.id,
      null,
      { manualEntry: true, clockIn, clockOut, status },
    );

    this.eventEmitter.emit('attendance.manual_entry', {
      tenantId,
      userId: dto.userId,
      recordId: record.id,
      actorId,
      date: dto.date,
    });

    this.logger.log(`Manual entry created for user=${dto.userId} date=${dto.date} by actor=${actorId}`);
    return this.normalizeRecord(record);
  }

  // ─── Update Record ────────────────────────────────────────────────────────

  async updateRecord(tenantId: string, id: string, dto: UpdateAttendanceDto, actorId: string) {
    const existing = await this.findOne(tenantId, id);

    const clockIn = dto.clockIn ? new Date(dto.clockIn) : existing.clockIn;
    const clockOut = dto.clockOut ? new Date(dto.clockOut) : existing.clockOut;

    if (clockIn && clockOut && clockOut <= clockIn) {
      throw new BadRequestException('Clock-out time must be after clock-in time.');
    }

    const policy = await this.getOrCreatePolicy(tenantId);
    let workMinutes = existing.workMinutes;
    let overtimeMinutes = existing.overtimeMinutes;

    if (clockIn && clockOut) {
      const calc = this.calculateWorkDuration(
        clockIn,
        clockOut,
        existing.breakMinutes,
        policy.overtimeAfterMinutes,
      );
      workMinutes = calc.workMinutes;
      overtimeMinutes = calc.overtimeMinutes;
    }

    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...(dto.clockIn && { clockIn: new Date(dto.clockIn) }),
        ...(dto.clockOut && { clockOut: new Date(dto.clockOut) }),
        ...(dto.status && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        workMinutes,
        overtimeMinutes,
        isManualEntry: true,
        manualEntryBy: actorId,
      },
      select: ATTENDANCE_SELECT,
    });

    await this.writeAuditLog(
      tenantId,
      existing.userId,
      actorId,
      AuditAction.UPDATE,
      'attendance',
      id,
      existing,
      dto,
    );

    this.eventEmitter.emit('attendance.updated', { tenantId, recordId: id, actorId, changes: dto });
    return this.normalizeRecord(record);
  }

  // ─── Policy ───────────────────────────────────────────────────────────────

  async getPolicy(tenantId: string) {
    return this.getOrCreatePolicy(tenantId);
  }

  async upsertPolicy(tenantId: string, dto: AttendancePolicyDto, actorId: string) {
    const policy = await this.prisma.attendancePolicy.upsert({
      where: { tenantId },
      update: { ...dto },
      create: { tenantId, ...dto },
    });

    await this.redis.del(this.policyKey(tenantId));

    await this.writeAuditLog(
      tenantId,
      null,
      actorId,
      AuditAction.UPDATE,
      'attendance_policy',
      policy.id,
      null,
      dto,
    );

    this.eventEmitter.emit('attendance.policy_updated', { tenantId, actorId });
    return policy;
  }

  // ─── Private: Session Cache ───────────────────────────────────────────────

  private sessionKey(tenantId: string, userId: string): string {
    return this.redis.buildTenantKey(tenantId, 'attendance_session', userId);
  }

  private breakKey(tenantId: string, userId: string): string {
    return this.redis.buildTenantKey(tenantId, 'attendance_break', userId);
  }

  private policyKey(tenantId: string): string {
    return this.redis.buildTenantKey(tenantId, 'attendance_policy', 'current');
  }

  private async getActiveSessionFromCache(tenantId: string, userId: string): Promise<ActiveSession | null> {
    return this.redis.get<ActiveSession>(this.sessionKey(tenantId, userId));
  }

  private async getActiveBreakFromCache(tenantId: string, userId: string): Promise<ActiveSession | null> {
    return this.redis.get<ActiveSession>(this.breakKey(tenantId, userId));
  }

  private async cacheActiveSession(tenantId: string, userId: string, session: ActiveSession): Promise<void> {
    await this.redis.set(this.sessionKey(tenantId, userId), session, SESSION_TTL);
  }

  private async cacheActiveBreak(tenantId: string, userId: string, session: ActiveSession): Promise<void> {
    await this.redis.set(this.breakKey(tenantId, userId), session, BREAK_TTL);
    // Keep session key in sync with break state
    await this.redis.set(this.sessionKey(tenantId, userId), session, SESSION_TTL);
  }

  private async clearActiveSession(tenantId: string, userId: string): Promise<void> {
    await this.redis.del(
      this.sessionKey(tenantId, userId),
      this.breakKey(tenantId, userId),
    );
  }

  private async clearActiveBreak(tenantId: string, userId: string): Promise<void> {
    const session = await this.getActiveSessionFromCache(tenantId, userId);
    if (session) {
      const cleanSession: ActiveSession = {
        recordId: session.recordId,
        clockIn: session.clockIn,
        date: session.date,
      };
      await this.redis.set(this.sessionKey(tenantId, userId), cleanSession, SESSION_TTL);
    }
    await this.redis.del(this.breakKey(tenantId, userId));
  }

  // ─── Private: Policy Cache ────────────────────────────────────────────────

 private async getOrCreatePolicy(
   tenantId: string,
): Promise<Prisma.AttendancePolicyGetPayload<Record<string, never>>> {
  const cacheKey = this.policyKey(tenantId);
   

 const cached = 
  await this.redis.get<Prisma.AttendancePolicyGetPayload<Record<string, never>>>(cacheKey);

 if (cached) {
   return cached;
}

    let policy = await this.prisma.attendancePolicy.findUnique({ where: { tenantId } });
    if (!policy) {
      policy = await this.prisma.attendancePolicy.create({ data: { tenantId } });
    }

    await this.redis.set(cacheKey, policy, POLICY_CACHE_TTL);
    return policy;
  }

  // ─── Private: Business Logic ──────────────────────────────────────────────

  private detectLate(
    clockIn: Date,
    scheduledIn: Date | null | undefined,
    graceMinutes: number,
  ): { isLate: boolean; lateMinutes: number } {
    if (!scheduledIn) return { isLate: false, lateMinutes: 0 };
    const diff = differenceInMinutes(clockIn, scheduledIn);
    if (diff > graceMinutes) {
      return { isLate: true, lateMinutes: diff };
    }
    return { isLate: false, lateMinutes: 0 };
  }

  private detectEarlyDeparture(
    clockOut: Date,
    scheduledOut: Date | null | undefined,
    graceMinutes: number,
  ): { isEarlyDeparture: boolean; earlyMinutes: number } {
    if (!scheduledOut) return { isEarlyDeparture: false, earlyMinutes: 0 };
    const diff = differenceInMinutes(scheduledOut, clockOut);
    if (diff > graceMinutes) {
      return { isEarlyDeparture: true, earlyMinutes: diff };
    }
    return { isEarlyDeparture: false, earlyMinutes: 0 };
  }

  private calculateWorkDuration(
    clockIn: Date,
    clockOut: Date,
    breakMinutes: number,
    overtimeAfterMinutes: number,
  ): { workMinutes: number; overtimeMinutes: number } {
    const totalMinutes = differenceInMinutes(clockOut, clockIn);
    const workMinutes = Math.max(0, totalMinutes - breakMinutes);
    const overtimeMinutes = Math.max(0, workMinutes - overtimeAfterMinutes);
    return { workMinutes, overtimeMinutes };
  }

  private async assertWithinAllowedLocation(
    tenantId: string,
    latitude: number,
    longitude: number,
    locationId: string | undefined,
    policyRadius: number,
  ): Promise<void> {
    const location = locationId
      ? await this.prisma.location.findFirst({ where: { id: locationId, tenantId, isActive: true } })
      : await this.prisma.location.findFirst({ where: { tenantId, isActive: true } });

    if (!location || location.latitude === null || location.longitude === null) return;

    const radius = location.radiusMeters ?? policyRadius;
    const distance = this.haversineDistance(
      latitude,
      longitude,
      Number(location.latitude),
      Number(location.longitude),
    );

    if (distance > radius) {
      throw new ForbiddenException(
        `You are ${Math.round(distance)}m from the work location. Must be within ${radius}m.`,
      );
    }
  }

  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async closeBreak(breakId: string, tenantId: string, endTime: Date): Promise<void> {
    const b = await this.prisma.attendanceBreak.findFirst({ where: { id: breakId, tenantId } });
    if (!b) return;
    await this.prisma.attendanceBreak.update({
      where: { id: breakId },
      data: {
        endTime,
        durationMinutes: differenceInMinutes(endTime, b.startTime),
      },
    });
  }

  // ─── Private: Audit Log ───────────────────────────────────────────────────

  private async writeAuditLog(
    tenantId: string,
    userId: string | null,
    actorId: string,
    action: AuditAction,
    resource: string,
    resourceId: string,
    oldValues: unknown,
    newValues: unknown,
    ipAddress?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          actorId,
          action,
          resource,
          resourceId,
          oldValues: oldValues as Prisma.InputJsonValue,
          newValues: newValues as Prisma.InputJsonValue,
          status: AuditStatus.SUCCESS,
          ipAddress: ipAddress ?? null,
        },
      });
    } catch (err) {
      // Never let audit failure break the main operation
      this.logger.error(`Audit log write failed for ${resource}/${resourceId}: ${err}`);
    }
  }

  // ─── Private: Serialization ───────────────────────────────────────────────

 private normalizeRecord(
   record: Prisma.AttendanceRecordGetPayload<{
    select: typeof ATTENDANCE_SELECT;
}>
) {
    return {
      ...record,
      clockInLat: record.clockInLat != null ? Number(record.clockInLat) : null,
      clockInLng: record.clockInLng != null ? Number(record.clockInLng) : null,
      clockOutLat: record.clockOutLat != null ? Number(record.clockOutLat) : null,
      clockOutLng: record.clockOutLng != null ? Number(record.clockOutLng) : null,
    };
  }
}
