import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BreakType } from '@prisma/client';
import { ShiftsService } from './shifts.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CreateShiftDto, CreateBreakRuleDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { CreateRotationDto, UpsertRotationSlotDto } from './dto/shift-rotation.dto';

// Precisely typing this mock would mean replacing every model/method with
// real Prisma-generated types across ~70 mockPrisma.<model>.<method> call
// sites below — out of proportion for a test double. `any` is deliberate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: Record<string, any> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: jest.fn((callback: any) => callback(mockPrisma)),
  shift: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  shiftBreakRule: {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  shiftAssignment: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  shiftRotation: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  shiftRotationSlot: {
    upsert: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  buildTenantKey: jest.fn((tenantId: string, prefix: string, id: string) => `tenant:${tenantId}:${prefix}:${id}`),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('ShiftsService', () => {
  let service: ShiftsService;

  const TENANT_ID = 'tenant-uuid-1';
  const ACTOR_ID = 'actor-uuid-1';
  const SHIFT_ID = 'shift-uuid-1';
  const USER_ID = 'user-uuid-1';

  const mockShift = {
    id: SHIFT_ID,
    tenantId: TENANT_ID,
    name: 'Morning Shift',
    code: 'MORN',
    description: null,
    startTime: '09:00',
    endTime: '17:00',
    isNightShift: false,
    workDays: [1, 2, 3, 4, 5],
    graceMinutes: 10,
    overtimeAfterMinutes: 480,
    colorCode: '#3B82F6',
    isActive: true,
    metadata: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    breakRules: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ShiftsService>(ShiftsService);
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a shift and emits shift.created event', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);
      mockPrisma.shift.create.mockResolvedValue(mockShift);

      const dto = { name: 'Morning Shift', startTime: '09:00', endTime: '17:00' };
      const result = await service.create(TENANT_ID, dto as unknown as CreateShiftDto, ACTOR_ID);

      expect(mockPrisma.shift.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_ID, name: 'Morning Shift' }) }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('shift.created', expect.objectContaining({ tenantId: TENANT_ID }));
      expect(result).toEqual(mockShift);
    });

    it('throws ConflictException when shift code already exists', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);

      await expect(
        service.create(TENANT_ID, { name: 'X', startTime: '09:00', endTime: '17:00', code: 'MORN' } as unknown as CreateShiftDto, ACTOR_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns cached shift without hitting DB', async () => {
      mockRedis.get.mockResolvedValue(mockShift);

      const result = await service.findOne(TENANT_ID, SHIFT_ID);

      expect(mockPrisma.shift.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual(mockShift);
    });

    it('fetches from DB on cache miss and caches result', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);

      const result = await service.findOne(TENANT_ID, SHIFT_ID);

      expect(mockPrisma.shift.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SHIFT_ID, tenantId: TENANT_ID, deletedAt: null } }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(SHIFT_ID),
        mockShift,
        300,
      );
      expect(result).toEqual(mockShift);
    });

    it('throws NotFoundException when shift does not exist', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(null);

      await expect(service.findOne(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates shift and invalidates cache', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);
      mockPrisma.shift.update.mockResolvedValue({ ...mockShift, name: 'Evening Shift' });

      const result = await service.update(TENANT_ID, SHIFT_ID, { name: 'Evening Shift' } as unknown as UpdateShiftDto, ACTOR_ID);

      expect(mockRedis.del).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('shift.updated', expect.objectContaining({ shiftId: SHIFT_ID }));
      expect(result.name).toBe('Evening Shift');
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft deletes shift and emits event', async () => {
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);
      mockPrisma.shift.update.mockResolvedValue({ ...mockShift, deletedAt: new Date(), isActive: false });

      const result = await service.remove(TENANT_ID, SHIFT_ID, ACTOR_ID);

      expect(mockPrisma.shift.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }) }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('shift.deleted', expect.any(Object));
      expect(result).toEqual({ success: true });
    });
  });

  // ─── addBreakRule ─────────────────────────────────────────────────────────

  describe('addBreakRule', () => {
    it('adds a break rule and invalidates shift cache', async () => {
      const mockRule = {
        id: 'rule-1',
        tenantId: TENANT_ID,
        shiftId: SHIFT_ID,
        name: 'Lunch',
        breakType: BreakType.LUNCH,
        startOffsetMins: 240,
        durationMinutes: 30,
        isPaid: false,
        isRequired: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);
      mockPrisma.shiftBreakRule.create.mockResolvedValue(mockRule);

      const result = await service.addBreakRule(
        TENANT_ID,
        SHIFT_ID,
        { name: 'Lunch', startOffsetMins: 240, durationMinutes: 30, breakType: BreakType.LUNCH } as unknown as CreateBreakRuleDto,
        ACTOR_ID,
      );

      expect(mockRedis.del).toHaveBeenCalled();
      expect(result).toEqual(mockRule);
    });
  });

  // ─── assignShift ──────────────────────────────────────────────────────────

  describe('assignShift', () => {
    const mockAssignment = {
      id: 'assignment-1',
      tenantId: TENANT_ID,
      userId: USER_ID,
      shiftId: SHIFT_ID,
      rotationId: null,
      startDate: new Date('2025-01-01'),
      endDate: null,
      assignedBy: ACTOR_ID,
      isActive: true,
      notes: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      shift: null,
    };

    it('assigns a shift to a user and emits shift.assigned event', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: USER_ID });
      mockPrisma.shift.findFirst.mockResolvedValue(mockShift);
      mockPrisma.shiftAssignment.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.shiftAssignment.create.mockResolvedValue(mockAssignment);

      const result = await service.assignShift(
        TENANT_ID,
        { userId: USER_ID, shiftId: SHIFT_ID, startDate: '2025-01-01' } as unknown as AssignShiftDto,
        ACTOR_ID,
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('shift.assigned', expect.objectContaining({ userId: USER_ID }));
      expect(result).toEqual(mockAssignment);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assignShift(TENANT_ID, { userId: 'bad-id', shiftId: SHIFT_ID, startDate: '2025-01-01' } as unknown as AssignShiftDto, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getEffectiveShift ────────────────────────────────────────────────────

  describe('getEffectiveShift', () => {
    const date = new Date('2025-01-06'); // Monday, ISO day 1

    it('returns null when no active assignment', async () => {
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue(null);

      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, date);
      expect(result).toBeNull();
    });

    it('returns EffectiveShift for a fixed-shift assignment', async () => {
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
        shift: { ...mockShift, breakRules: [] },
        rotation: null,
      });

      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, date);

      if (!result) throw new Error('expected getEffectiveShift to return a result');
      expect(result.shiftId).toBe(SHIFT_ID);
      expect(result.scheduledIn).toEqual(expect.any(Date));
      expect(result.scheduledOut).toEqual(expect.any(Date));
      expect(result.graceMinutes).toBe(10);
    });

    it('returns null when shift does not run on this weekday', async () => {
      const sunday = new Date('2025-01-05'); // Sunday, ISO day 7
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
        shift: { ...mockShift, workDays: [1, 2, 3, 4, 5], breakRules: [] },
        rotation: null,
      });

      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, sunday);
      expect(result).toBeNull();
    });

    it('resolves night shift scheduledOut to next day', async () => {
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
        shift: {
          ...mockShift,
          startTime: '22:00',
          endTime: '06:00',
          isNightShift: true,
          workDays: [1, 2, 3, 4, 5, 6, 7],
          breakRules: [],
        },
        rotation: null,
      });

      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, date);

      if (!result) throw new Error('expected getEffectiveShift to return a result');
      // scheduledOut should be on the next calendar day
      expect(result.scheduledOut.getDate()).toBe(date.getDate() + 1);
    });

    it('resolves rotation slot for the target date', async () => {
      const rotationShift = { ...mockShift, id: 'rotation-shift-1', breakRules: [] };
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
        shift: null,
        rotation: {
          id: 'rotation-1',
          cycleDays: 7,
          startDate: new Date('2025-01-01'), // Wednesday
          slots: [
            { dayOffset: 5, shiftId: 'rotation-shift-1', shift: rotationShift }, // Monday offset from Wed start
          ],
        },
      });

      // 2025-01-06 (Mon) is 5 days after 2025-01-01 (Wed) → cycleDay 5 → matches slot
      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, date);

      if (!result) throw new Error('expected getEffectiveShift to return a result');
      expect(result.shiftId).toBe('rotation-shift-1');
    });

    it('returns null for day-off rotation slot', async () => {
      mockPrisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
        shift: null,
        rotation: {
          id: 'rotation-1',
          cycleDays: 7,
          startDate: new Date('2025-01-01'),
          slots: [
            { dayOffset: 5, shiftId: null, shift: null },
          ],
        },
      });

      const result = await service.getEffectiveShift(TENANT_ID, USER_ID, date);
      expect(result).toBeNull();
    });
  });

  // ─── buildShiftDateTime ───────────────────────────────────────────────────

  describe('buildShiftDateTime', () => {
    const date = new Date('2025-06-15T00:00:00.000Z');

    it('builds correct datetime for standard shift', () => {
      const result = service.buildShiftDateTime('09:00', date, false);
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(0);
    });

    it('adds one day for night-shift end time', () => {
      const result = service.buildShiftDateTime('06:00', date, true);
      expect(result.getDate()).toBe(new Date(date.getTime() + 86400000).getDate());
    });
  });

  // ─── createRotation ───────────────────────────────────────────────────────

  describe('createRotation', () => {
    it('creates a rotation and emits event', async () => {
      const mockRotation = {
        id: 'rotation-1',
        tenantId: TENANT_ID,
        name: '2-Week Rotation',
        cycleDays: 14,
        startDate: new Date('2025-01-06'),
        isActive: true,
        slots: [],
      };
      mockPrisma.shiftRotation.findFirst.mockResolvedValue(null);
      mockPrisma.shiftRotation.create.mockResolvedValue(mockRotation);

      const result = await service.createRotation(
        TENANT_ID,
        { name: '2-Week Rotation', cycleDays: 14, startDate: '2025-01-06' } as unknown as CreateRotationDto,
        ACTOR_ID,
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('shift.rotation_created', expect.any(Object));
      expect(result).toEqual(mockRotation);
    });

    it('throws ConflictException when rotation name already exists', async () => {
      mockPrisma.shiftRotation.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createRotation(TENANT_ID, { name: 'Existing', cycleDays: 7, startDate: '2025-01-01' } as unknown as CreateRotationDto, ACTOR_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── upsertRotationSlot ───────────────────────────────────────────────────

  describe('upsertRotationSlot', () => {
    it('throws BadRequestException for out-of-range dayOffset', async () => {
      const rotation = {
        id: 'rotation-1',
        tenantId: TENANT_ID,
        cycleDays: 7,
        slots: [],
        startDate: new Date(),
        deletedAt: null,
      };
      mockPrisma.shiftRotation.findFirst.mockResolvedValue(rotation);

      await expect(
        service.upsertRotationSlot(TENANT_ID, 'rotation-1', { dayOffset: 10, shiftId: null } as unknown as UpsertRotationSlotDto, ACTOR_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
