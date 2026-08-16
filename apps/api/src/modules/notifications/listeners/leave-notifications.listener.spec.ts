import { Test, TestingModule } from '@nestjs/testing';
import { LeaveRequestStatus, NotificationCategory, NotificationPriority } from '@prisma/client';
import { LeaveNotificationsListener } from './leave-notifications.listener';
import { NotificationsService } from '../notifications.service';

const mockNotificationsService = {
  create: jest.fn(),
};

describe('LeaveNotificationsListener', () => {
  let listener: LeaveNotificationsListener;

  const TENANT_ID = 'tenant-uuid-1';
  const USER_ID = 'user-uuid-1';
  const ACTOR_ID = 'actor-uuid-1';
  const REQUEST_ID = 'leave-request-uuid-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveNotificationsListener,
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    listener = module.get<LeaveNotificationsListener>(LeaveNotificationsListener);
    jest.clearAllMocks();
  });

  // ─── leave.requested ────────────────────────────────────────────────────

  describe('onLeaveRequested', () => {
    it('notifies the submitter when the request is pending approval', async () => {
      await listener.onLeaveRequested({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        status: LeaveRequestStatus.PENDING,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          userId: USER_ID,
          category: NotificationCategory.LEAVE,
          resource: 'leave_request',
          resourceId: REQUEST_ID,
        }),
      );
    });

    it('skips notifying when the request was auto-approved (leave.approved covers it)', async () => {
      await listener.onLeaveRequested({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        status: LeaveRequestStatus.APPROVED,
      });

      expect(mockNotificationsService.create).not.toHaveBeenCalled();
    });
  });

  // ─── leave.approved ─────────────────────────────────────────────────────

  describe('onLeaveApproved', () => {
    it('notifies the leave owner on a reviewer-driven approval', async () => {
      await listener.onLeaveApproved({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          userId: USER_ID,
          priority: NotificationPriority.NORMAL,
          message: 'Your leave request has been approved.',
          metadata: { actorId: ACTOR_ID, autoApproved: false },
        }),
      );
    });

    it('uses an auto-approval message and no actor when autoApproved is true', async () => {
      await listener.onLeaveApproved({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        autoApproved: true,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          message: 'Your leave request was automatically approved.',
          metadata: { actorId: null, autoApproved: true },
        }),
      );
    });
  });

  // ─── leave.rejected ─────────────────────────────────────────────────────

  describe('onLeaveRejected', () => {
    it('notifies the leave owner with high priority', async () => {
      await listener.onLeaveRejected({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          userId: USER_ID,
          priority: NotificationPriority.HIGH,
          title: 'Leave request rejected',
          metadata: { actorId: ACTOR_ID },
        }),
      );
    });
  });

  // ─── leave.cancelled ────────────────────────────────────────────────────

  describe('onLeaveCancelled', () => {
    it('notifies the leave owner when a previously-approved leave is cancelled', async () => {
      await listener.onLeaveCancelled({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
        previousStatus: LeaveRequestStatus.APPROVED,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          userId: USER_ID,
          priority: NotificationPriority.HIGH,
          title: 'Approved leave cancelled',
          metadata: { actorId: ACTOR_ID, previousStatus: LeaveRequestStatus.APPROVED },
        }),
      );
    });

    it('does not notify when a still-pending leave is cancelled', async () => {
      await listener.onLeaveCancelled({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
        previousStatus: LeaveRequestStatus.PENDING,
      });

      expect(mockNotificationsService.create).not.toHaveBeenCalled();
    });

    it('notifies the leave owner even when an admin (not the owner) performed the cancellation', async () => {
      await listener.onLeaveCancelled({
        tenantId: TENANT_ID,
        userId: USER_ID,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
        previousStatus: LeaveRequestStatus.APPROVED,
      });

      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ userId: USER_ID }),
      );
    });
  });

  // ─── error isolation ────────────────────────────────────────────────────

  describe('failure isolation', () => {
    it('swallows NotificationsService errors instead of throwing, so a failed notification never surfaces to the emitter', async () => {
      mockNotificationsService.create.mockRejectedValueOnce(new Error('db unavailable'));

      await expect(
        listener.onLeaveRejected({
          tenantId: TENANT_ID,
          userId: USER_ID,
          requestId: REQUEST_ID,
          actorId: ACTOR_ID,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
