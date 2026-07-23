import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AttendanceStatus, ClockMethod, BreakType, AuditAction, AuditStatus } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { ShiftsService } from '../shifts/shifts.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  attendanceRecord: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  attendanceBreak: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  attendancePolicy: {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  location: {
    findFirst: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  buildTenantKey: jest.fn((tenantId: string, ...parts: string[]) => `tenant:${tenantId}:${parts.join(':')}`),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

// No effective shift by default, matching every existing test's assumption
// that ShiftsModule isn't loaded; override with mockResolvedValueOnce in
// tests that need to exercise shift-relative logic (e.g. late detection).
const mockShiftsService = {
  getEffectiveShift: jest.fn().mockResolvedValue(null),
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-001';
const USER_ID = 'user-uuid-001';
const ACTOR_ID = 'actor-uuid-002';
const RECORD_ID = 'record-uuid-001';
const BREAK_ID = 'break-uuid-001';

const today = new Date();
today.setHours(0, 0, 0, 0);

const basePolicy = {
  id: 'policy-uuid-001',
  tenantId: TENANT_ID,
  graceMinutes: 15,
  autoClockOutMinutes: null,
  maxWorkHours: 12,
  minBreakMinutes: 0,
  maxBreakMinutes: 60,
  overtimeAfterMinutes: 480,
  requireGpsLocation: false,
  gpsRadiusMeters: 100,
  allowMobileClockIn: true,
  allowedMethods: ['MANUAL', 'QR_CODE', 'MOBILE', 'WEB'],
  isActive: true,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseRecord = {
  id: RECORD_ID,
  tenantId: TENANT_ID,
  userId: USER_ID,
  shiftId: null,
  locationId: null,
  date: today,
  scheduledIn: null,
  scheduledOut: null,
  clockIn: new Date(),
  clockOut: null,
  clockInMethod: ClockMethod.MANUAL,
  clockOutMethod: null,
  clockInLat: null,
  clockInLng: null,
  clockOutLat: null,
  clockOutLng: null,
  clockInDevice: null,
  clockOutDevice: null,
  clockInIp: null,
  clockOutIp: null,
  status: AttendanceStatus.PRESENT,
  workMinutes: null,
  overtimeMinutes: null,
  breakMinutes: 0,
  isLate: false,
  lateMinutes: 0,
  isEarlyDeparture: false,
  earlyMinutes: 0,
  isManualEntry: false,
  manualEntryBy: null,
  notes: null,
  approvalStatus: null,
  approvedBy: null,
  approvedAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  breaks: [],
  user: { id: USER_ID, firstName: 'John', lastName: 'Doe', employeeId: 'EMP001', email: 'john@example.com' },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ShiftsService, useValue: mockShiftsService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    jest.clearAllMocks();
  });

  // ─── clockIn ──────────────────────────────────────────────────────────────

  describe('clockIn', () => {
    it('creates an attendance record and caches the session on success', async () => {
      mockRedis.get.mockResolvedValueOnce(null); // no active session in Redis
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null); // no DB session
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockPrisma.attendanceRecord.upsert.mockResolvedValueOnce(baseRecord);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.clockIn(TENANT_ID, USER_ID, {}, '127.0.0.1');

      expect(result.id).toBe(RECORD_ID);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('attendance_session'),
        expect.objectContaining({ recordId: RECORD_ID }),
        86400,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.clocked_in',
        expect.objectContaining({ userId: USER_ID, recordId: RECORD_ID }),
      );
    });

    it('throws ConflictException when already clocked in via Redis cache', async () => {
      mockRedis.get.mockResolvedValueOnce({
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      });

      await expect(service.clockIn(TENANT_ID, USER_ID, {}, '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when DB has an open session (Redis miss)', async () => {
      mockRedis.get.mockResolvedValueOnce(null); // Redis miss
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce({ ...baseRecord, clockOut: null }); // DB has open record

      await expect(service.clockIn(TENANT_ID, USER_ID, {}, '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ForbiddenException when GPS is required but not provided', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce({
        ...basePolicy,
        requireGpsLocation: true,
      });

      await expect(service.clockIn(TENANT_ID, USER_ID, {}, '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException for disallowed clock method', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce({
        ...basePolicy,
        allowedMethods: ['QR_CODE'],
      });

      await expect(
        service.clockIn(TENANT_ID, USER_ID, { method: ClockMethod.MANUAL }, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks attendance as LATE when clock-in exceeds grace period', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      // Late detection is computed from the effective shift's scheduledIn,
      // not from the mocked upsert() return value — without this, isLate
      // is always false regardless of what the DB mock claims.
      mockShiftsService.getEffectiveShift.mockResolvedValueOnce({
        shiftId: 'shift-uuid-1',
        scheduledIn: new Date(Date.now() - 35 * 60 * 1000), // 35 min ago
        scheduledOut: null,
        graceMinutes: 0,
      });

      const lateRecord = {
        ...baseRecord,
        status: AttendanceStatus.LATE,
        isLate: true,
        lateMinutes: 20,
        scheduledIn: new Date(Date.now() - 35 * 60 * 1000), // 35 min ago
      };
      mockPrisma.attendanceRecord.upsert.mockResolvedValueOnce(lateRecord);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.clockIn(TENANT_ID, USER_ID, {}, '127.0.0.1');

      expect(result.status).toBe(AttendanceStatus.LATE);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.late',
        expect.objectContaining({ userId: USER_ID }),
      );
    });
  });

  // ─── clockOut ─────────────────────────────────────────────────────────────

  describe('clockOut', () => {
    it('calculates work duration and clears session on success', async () => {
      const clockInTime = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9 hours ago
      const session = {
        recordId: RECORD_ID,
        clockIn: clockInTime.toISOString(),
        date: today.toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(session);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce({
        ...baseRecord,
        clockIn: clockInTime,
        clockOut: null,
        breaks: [],
      });
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockPrisma.attendanceBreak.findMany.mockResolvedValueOnce([]);
      mockPrisma.attendanceRecord.update.mockResolvedValueOnce({
        ...baseRecord,
        clockIn: clockInTime,
        clockOut: new Date(),
        workMinutes: 540,
        overtimeMinutes: 60,
        status: AttendanceStatus.OVERTIME,
      });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.clockOut(TENANT_ID, USER_ID, {}, '127.0.0.1');

      expect(result.workMinutes).toBe(540);
      expect(result.status).toBe(AttendanceStatus.OVERTIME);
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.clocked_out',
        expect.objectContaining({ userId: USER_ID }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.overtime',
        expect.objectContaining({ overtimeMinutes: 60 }),
      );
    });

    it('throws BadRequestException when no active session exists', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);

      await expect(service.clockOut(TENANT_ID, USER_ID, {}, '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when already clocked out', async () => {
      const session = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(session);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce({
        ...baseRecord,
        clockOut: new Date(), // already clocked out
        breaks: [],
      });

      await expect(service.clockOut(TENANT_ID, USER_ID, {}, '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── startBreak ───────────────────────────────────────────────────────────

  describe('startBreak', () => {
    it('creates a break record and updates Redis cache', async () => {
      const session = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      };

      // First get: check active session (session key) — has session
      // Second get: check active break (break key) — no break
      mockRedis.get
        .mockResolvedValueOnce(session)  // getActiveSessionFromCache
        .mockResolvedValueOnce(null);    // getActiveBreakFromCache

      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockPrisma.attendanceBreak.findMany.mockResolvedValueOnce([]);
      mockPrisma.attendanceBreak.create.mockResolvedValueOnce({
        id: BREAK_ID,
        tenantId: TENANT_ID,
        attendanceId: RECORD_ID,
        breakType: BreakType.SHORT_BREAK,
        startTime: new Date(),
        endTime: null,
        durationMinutes: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.startBreak(TENANT_ID, USER_ID, {});

      expect(result.id).toBe(BREAK_ID);
      expect(result.breakType).toBe(BreakType.SHORT_BREAK);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('attendance_break'),
        expect.objectContaining({ activeBreakId: BREAK_ID }),
        14400,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.break_started',
        expect.objectContaining({ breakId: BREAK_ID }),
      );
    });

    it('throws BadRequestException when not clocked in', async () => {
      mockRedis.get.mockResolvedValueOnce(null); // no session

      await expect(service.startBreak(TENANT_ID, USER_ID, {})).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when already on break', async () => {
      const session = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      };

      mockRedis.get
        .mockResolvedValueOnce(session) // has session
        .mockResolvedValueOnce({ ...session, activeBreakId: BREAK_ID }); // has break

      await expect(service.startBreak(TENANT_ID, USER_ID, {})).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when max break minutes exhausted', async () => {
      const session = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      };

      mockRedis.get
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(null);

      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce({
        ...basePolicy,
        maxBreakMinutes: 30,
      });
      mockPrisma.attendanceBreak.findMany.mockResolvedValueOnce([
        { durationMinutes: 30 }, // exactly at the limit
      ]);

      await expect(service.startBreak(TENANT_ID, USER_ID, {})).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── endBreak ─────────────────────────────────────────────────────────────

  describe('endBreak', () => {
    it('sets endTime, calculates duration, and updates attendance breakMinutes', async () => {
      const breakStartTime = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
      const breakSession = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
        activeBreakId: BREAK_ID,
        breakStartTime: breakStartTime.toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(breakSession);
      mockPrisma.attendanceBreak.findFirst.mockResolvedValueOnce({
        id: BREAK_ID,
        tenantId: TENANT_ID,
        attendanceId: RECORD_ID,
        startTime: breakStartTime,
        endTime: null,
        durationMinutes: null,
      });
      mockPrisma.attendanceBreak.update.mockResolvedValueOnce({
        id: BREAK_ID,
        endTime: new Date(),
        durationMinutes: 20,
      });
      mockPrisma.attendanceBreak.findMany.mockResolvedValueOnce([{ durationMinutes: 20 }]);
      mockPrisma.attendanceRecord.update.mockResolvedValueOnce({ ...baseRecord, breakMinutes: 20 });

      const result = await service.endBreak(TENANT_ID, USER_ID, {});

      expect(result.durationMinutes).toBe(20);
      expect(mockPrisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ breakMinutes: 20 }) }),
      );
      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.break_ended',
        expect.objectContaining({ breakId: BREAK_ID, durationMinutes: 20 }),
      );
    });

    it('throws BadRequestException when no active break in Redis or DB', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);

      await expect(service.endBreak(TENANT_ID, USER_ID, {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when break record is not found in DB', async () => {
      const breakSession = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
        activeBreakId: BREAK_ID,
      };

      mockRedis.get.mockResolvedValueOnce(breakSession);
      mockPrisma.attendanceBreak.findFirst.mockResolvedValueOnce(null); // DB lookup fails

      await expect(service.endBreak(TENANT_ID, USER_ID, {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getActiveSession ─────────────────────────────────────────────────────

  describe('getActiveSession', () => {
    it('returns the cached session from Redis', async () => {
      const session = {
        recordId: RECORD_ID,
        clockIn: new Date().toISOString(),
        date: today.toISOString(),
      };

      // getActiveBreakFromCache (break key)
      mockRedis.get.mockResolvedValueOnce(null);
      // getActiveSessionFromCache (session key)
      mockRedis.get.mockResolvedValueOnce(session);

      const result = await service.getActiveSession(TENANT_ID, USER_ID);
      expect(result).toEqual(session);
    });

    it('returns null when no active session exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce(null);

      const result = await service.getActiveSession(TENANT_ID, USER_ID);
      expect(result).toBeNull();
    });

    it('rebuilds session from DB on Redis miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.attendanceRecord.findFirst.mockResolvedValueOnce({
        id: RECORD_ID,
        clockIn: new Date(),
        date: today,
        breaks: [],
      });

      const result = await service.getActiveSession(TENANT_ID, USER_ID);
      expect(result?.recordId).toBe(RECORD_ID);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  // ─── getPolicy ────────────────────────────────────────────────────────────

  describe('getPolicy', () => {
    it('returns cached policy without hitting DB', async () => {
      mockRedis.get.mockResolvedValueOnce(basePolicy);

      const result = await service.getPolicy(TENANT_ID);
      expect(result).toEqual(basePolicy);
      expect(mockPrisma.attendancePolicy.findUnique).not.toHaveBeenCalled();
    });

    it('creates default policy when none exists', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.create.mockResolvedValueOnce(basePolicy);

      const result = await service.getPolicy(TENANT_ID);
      expect(result).toEqual(basePolicy);
      expect(mockPrisma.attendancePolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });
  });

  // ─── createManualEntry ────────────────────────────────────────────────────

  describe('createManualEntry', () => {
    it('creates a manual attendance entry and emits event', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID });
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockRedis.get.mockResolvedValueOnce(null); // policy cache miss

      const manualRecord = {
        ...baseRecord,
        isManualEntry: true,
        manualEntryBy: ACTOR_ID,
        clockIn: new Date('2025-01-15T09:00:00Z'),
        clockOut: new Date('2025-01-15T17:00:00Z'),
        workMinutes: 480,
        overtimeMinutes: 0,
      };
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockPrisma.attendanceRecord.upsert.mockResolvedValueOnce(manualRecord);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.createManualEntry(
        TENANT_ID,
        {
          userId: USER_ID,
          date: '2025-01-15',
          clockIn: '2025-01-15T09:00:00Z',
          clockOut: '2025-01-15T17:00:00Z',
        },
        ACTOR_ID,
      );

      expect(result.isManualEntry).toBe(true);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.manual_entry',
        expect.objectContaining({ actorId: ACTOR_ID }),
      );
    });

    it('throws NotFoundException for non-existent user', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createManualEntry(TENANT_ID, { userId: 'bad-id', date: '2025-01-15' }, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when clock-out is before clock-in', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID });
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.attendancePolicy.findUnique.mockResolvedValueOnce(basePolicy);

      await expect(
        service.createManualEntry(
          TENANT_ID,
          {
            userId: USER_ID,
            date: '2025-01-15',
            clockIn: '2025-01-15T17:00:00Z',
            clockOut: '2025-01-15T09:00:00Z', // before clockIn
          },
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── upsertPolicy ─────────────────────────────────────────────────────────

  describe('upsertPolicy', () => {
    it('creates or updates policy and clears cache', async () => {
      const updatedPolicy = { ...basePolicy, graceMinutes: 10 };
      mockPrisma.attendancePolicy.upsert.mockResolvedValueOnce(updatedPolicy);
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.upsertPolicy(TENANT_ID, { graceMinutes: 10 }, ACTOR_ID);

      expect(result.graceMinutes).toBe(10);
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('attendance_policy'),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'attendance.policy_updated',
        expect.objectContaining({ tenantId: TENANT_ID }),
      );
    });
  });
});
