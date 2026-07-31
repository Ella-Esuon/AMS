import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeaveRequestStatus } from '@prisma/client';
import { LeavesService } from './leaves.service';
import { PrismaService } from '../../database/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';

// Precisely typing this mock would mean replacing every model/method with
// real Prisma-generated types across many mockPrisma.<model>.<method> call
// sites below — out of proportion for a test double. `any` is deliberate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: Record<string, any> = {
  leaveType: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  leaveBalance: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  leaveRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockAttendanceService = {
  setLeaveStatus: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('LeavesService', () => {
  let service: LeavesService;

  const TENANT_ID = 'tenant-uuid-1';
  const USER_ID = 'user-uuid-1';
  const ACTOR_ID = 'actor-uuid-1';
  const LEAVE_TYPE_ID = 'leave-type-uuid-1';
  const REQUEST_ID = 'leave-request-uuid-1';

  const mockLeaveType = {
    id: LEAVE_TYPE_ID,
    tenantId: TENANT_ID,
    name: 'Annual Leave',
    code: 'ANNUAL',
    description: null,
    isPaid: true,
    defaultDaysPerYear: 20,
    requiresApproval: true,
    colorCode: '#3B82F6',
    isActive: true,
    metadata: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
  };

  const mockBalance = {
    id: 'balance-uuid-1',
    tenantId: TENANT_ID,
    userId: USER_ID,
    leaveTypeId: LEAVE_TYPE_ID,
    year: 2025,
    allocatedDays: 20,
    usedDays: 0,
    carriedOverDays: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: AttendanceService, useValue: mockAttendanceService },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  // ─── createLeaveType ──────────────────────────────────────────────────────

  describe('createLeaveType', () => {
    it('creates a leave type and emits leave_type.created', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(null);
      mockPrisma.leaveType.create.mockResolvedValue(mockLeaveType);

      const dto = { name: 'Annual Leave', code: 'ANNUAL' } as unknown as CreateLeaveTypeDto;
      const result = await service.createLeaveType(TENANT_ID, dto, ACTOR_ID);

      expect(mockPrisma.leaveType.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_ID, name: 'Annual Leave' }) }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'leave_type.created',
        expect.objectContaining({ tenantId: TENANT_ID }),
      );
      expect(result).toEqual(mockLeaveType);
    });

    it('throws ConflictException when leave type code already exists', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);

      await expect(
        service.createLeaveType(TENANT_ID, { name: 'X', code: 'ANNUAL' } as unknown as CreateLeaveTypeDto, ACTOR_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── findLeaveType ────────────────────────────────────────────────────────

  describe('findLeaveType', () => {
    it('throws NotFoundException when leave type does not exist', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(null);
      await expect(service.findLeaveType(TENANT_ID, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateLeaveType ──────────────────────────────────────────────────────

  describe('updateLeaveType', () => {
    it('throws ConflictException when new code collides with another leave type', async () => {
      mockPrisma.leaveType.findFirst
        .mockResolvedValueOnce(mockLeaveType) // findLeaveType existence check
        .mockResolvedValueOnce({ id: 'other-id' }); // code conflict check

      await expect(
        service.updateLeaveType(TENANT_ID, LEAVE_TYPE_ID, { code: 'SICK' } as unknown as UpdateLeaveTypeDto, ACTOR_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── submitRequest ────────────────────────────────────────────────────────

  describe('submitRequest', () => {
    const baseDto = {
      leaveTypeId: LEAVE_TYPE_ID,
      startDate: '2025-06-02', // Monday
      endDate: '2025-06-03', // Tuesday
    } as unknown as CreateLeaveRequestDto;

    it('throws NotFoundException when leave type is missing or inactive', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(null);
      await expect(service.submitRequest(TENANT_ID, USER_ID, baseDto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when endDate is before startDate', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      const dto = { ...baseDto, startDate: '2025-06-03', endDate: '2025-06-02' } as unknown as CreateLeaveRequestDto;
      await expect(service.submitRequest(TENANT_ID, USER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the range spans more than one calendar year', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      const dto = { ...baseDto, startDate: '2025-12-30', endDate: '2026-01-02' } as unknown as CreateLeaveRequestDto;
      await expect(service.submitRequest(TENANT_ID, USER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for half-day requests spanning multiple dates', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      const dto = { ...baseDto, isHalfDay: true } as unknown as CreateLeaveRequestDto;
      await expect(service.submitRequest(TENANT_ID, USER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the range contains no working days', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      // 2025-06-07/08 is a Saturday/Sunday
      const dto = { ...baseDto, startDate: '2025-06-07', endDate: '2025-06-08' } as unknown as CreateLeaveRequestDto;
      await expect(service.submitRequest(TENANT_ID, USER_ID, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when an overlapping request already exists', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({ id: 'existing-request' });

      await expect(service.submitRequest(TENANT_ID, USER_ID, baseDto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when the leave balance is insufficient', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.leaveBalance.findUnique.mockResolvedValue({ ...mockBalance, allocatedDays: 1, usedDays: 0.5 });

      await expect(service.submitRequest(TENANT_ID, USER_ID, baseDto)).rejects.toThrow(BadRequestException);
    });

    it('creates a PENDING request when the leave type requires approval', async () => {
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.leaveBalance.findUnique.mockResolvedValue(mockBalance);
      mockPrisma.leaveRequest.create.mockResolvedValue({
        id: REQUEST_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: new Date('2025-06-02'),
        endDate: new Date('2025-06-03'),
        isHalfDay: false,
        totalDays: 2,
        status: LeaveRequestStatus.PENDING,
        reason: null,
      });

      const result = await service.submitRequest(TENANT_ID, USER_ID, baseDto);

      expect(mockPrisma.leaveRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: LeaveRequestStatus.PENDING, totalDays: 2 }),
        }),
      );
      expect(mockAttendanceService.setLeaveStatus).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'leave.requested',
        expect.objectContaining({ status: LeaveRequestStatus.PENDING }),
      );
      expect(result.status).toBe(LeaveRequestStatus.PENDING);
      expect(result.totalDays).toBe(2);
    });

    it('auto-approves and applies side effects when the leave type does not require approval', async () => {
      const autoApproveType = { ...mockLeaveType, requiresApproval: false };
      mockPrisma.leaveType.findFirst.mockResolvedValue(autoApproveType);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.leaveBalance.findUnique.mockResolvedValue(mockBalance);
      mockPrisma.leaveRequest.create.mockResolvedValue({
        id: REQUEST_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: new Date('2025-06-02'),
        endDate: new Date('2025-06-03'),
        isHalfDay: false,
        totalDays: 2,
        status: LeaveRequestStatus.APPROVED,
        reason: null,
      });
      mockPrisma.leaveBalance.update.mockResolvedValue(mockBalance);

      const result = await service.submitRequest(TENANT_ID, USER_ID, baseDto);

      expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedDays: { increment: 2 } } }),
      );
      expect(mockAttendanceService.setLeaveStatus).toHaveBeenCalledTimes(2); // Mon + Tue
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('leave.approved', expect.objectContaining({ autoApproved: true }));
      expect(result.status).toBe(LeaveRequestStatus.APPROVED);
    });
  });

  // ─── reviewRequest ────────────────────────────────────────────────────────

  describe('reviewRequest', () => {
    const pendingRequest = {
      id: REQUEST_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      leaveTypeId: LEAVE_TYPE_ID,
      startDate: new Date('2025-06-02'),
      endDate: new Date('2025-06-03'),
      totalDays: 2,
      status: LeaveRequestStatus.PENDING,
    };

    it('throws NotFoundException when the request does not exist', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      await expect(
        service.reviewRequest(TENANT_ID, REQUEST_ID, { decision: LeaveRequestStatus.APPROVED } as unknown as ReviewLeaveRequestDto, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the request is not pending', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({ ...pendingRequest, status: LeaveRequestStatus.APPROVED });
      await expect(
        service.reviewRequest(TENANT_ID, REQUEST_ID, { decision: LeaveRequestStatus.APPROVED } as unknown as ReviewLeaveRequestDto, ACTOR_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('approves the request, deducts the balance, and syncs attendance', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(pendingRequest);
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      mockPrisma.leaveBalance.findUnique.mockResolvedValue(mockBalance);
      mockPrisma.leaveBalance.update.mockResolvedValue(mockBalance);
      mockPrisma.leaveRequest.update.mockResolvedValue({ ...pendingRequest, status: LeaveRequestStatus.APPROVED });

      const result = await service.reviewRequest(
        TENANT_ID,
        REQUEST_ID,
        { decision: LeaveRequestStatus.APPROVED } as unknown as ReviewLeaveRequestDto,
        ACTOR_ID,
      );

      expect(mockPrisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedDays: { increment: 2 } } }),
      );
      expect(mockAttendanceService.setLeaveStatus).toHaveBeenCalledTimes(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('leave.approved', expect.objectContaining({ requestId: REQUEST_ID }));
      expect(result.status).toBe(LeaveRequestStatus.APPROVED);
    });

    it('rejects the request with a reason and does not touch balance or attendance', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(pendingRequest);
      mockPrisma.leaveRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: LeaveRequestStatus.REJECTED,
        rejectionReason: 'Understaffed',
      });

      const result = await service.reviewRequest(
        TENANT_ID,
        REQUEST_ID,
        { decision: LeaveRequestStatus.REJECTED, rejectionReason: 'Understaffed' } as unknown as ReviewLeaveRequestDto,
        ACTOR_ID,
      );

      expect(mockPrisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(mockAttendanceService.setLeaveStatus).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('leave.rejected', expect.objectContaining({ requestId: REQUEST_ID }));
      expect(result.status).toBe(LeaveRequestStatus.REJECTED);
    });
  });

  // ─── cancelOwnRequest ─────────────────────────────────────────────────────

  describe('cancelOwnRequest', () => {
    it('throws NotFoundException when the request is not found for this user', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      await expect(service.cancelOwnRequest(TENANT_ID, REQUEST_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the request is no longer pending', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({
        id: REQUEST_ID,
        userId: USER_ID,
        status: LeaveRequestStatus.APPROVED,
      });
      await expect(service.cancelOwnRequest(TENANT_ID, REQUEST_ID, USER_ID)).rejects.toThrow(ConflictException);
    });

    it('cancels a pending request and emits leave.cancelled', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({
        id: REQUEST_ID,
        userId: USER_ID,
        status: LeaveRequestStatus.PENDING,
      });
      mockPrisma.leaveRequest.update.mockResolvedValue({
        id: REQUEST_ID,
        userId: USER_ID,
        status: LeaveRequestStatus.CANCELLED,
        totalDays: 2,
      });

      const result = await service.cancelOwnRequest(TENANT_ID, REQUEST_ID, USER_ID);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('leave.cancelled', expect.objectContaining({ requestId: REQUEST_ID }));
      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    });
  });

  // ─── cancelRequest (admin) ────────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('reverses balance and attendance when cancelling an approved request', async () => {
      const approvedRequest = {
        id: REQUEST_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: new Date('2025-06-02'),
        endDate: new Date('2025-06-03'),
        totalDays: 2,
        status: LeaveRequestStatus.APPROVED,
      };
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(approvedRequest);
      mockPrisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      mockPrisma.leaveBalance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.leaveRequest.update.mockResolvedValue({ ...approvedRequest, status: LeaveRequestStatus.CANCELLED });

      const result = await service.cancelRequest(TENANT_ID, REQUEST_ID, ACTOR_ID);

      expect(mockPrisma.leaveBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedDays: { decrement: 2 } } }),
      );
      expect(mockAttendanceService.setLeaveStatus).toHaveBeenCalledWith(TENANT_ID, USER_ID, expect.any(Date), false);
      expect(result.status).toBe(LeaveRequestStatus.CANCELLED);
    });

    it('throws ConflictException when the request is already cancelled', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({ id: REQUEST_ID, status: LeaveRequestStatus.CANCELLED });
      await expect(service.cancelRequest(TENANT_ID, REQUEST_ID, ACTOR_ID)).rejects.toThrow(ConflictException);
    });
  });

  // ─── getMyBalances ────────────────────────────────────────────────────────

  describe('getMyBalances', () => {
    it('returns computed availableDays for each balance-tracked leave type', async () => {
      mockPrisma.leaveType.findMany.mockResolvedValue([mockLeaveType]);
      mockPrisma.leaveBalance.findUnique.mockResolvedValue({ ...mockBalance, allocatedDays: 20, usedDays: 5, carriedOverDays: 2 });

      const result = await service.getMyBalances(TENANT_ID, USER_ID, 2025);

      expect(result).toHaveLength(1);
      expect(result[0].availableDays).toBe(17);
    });
  });
});
