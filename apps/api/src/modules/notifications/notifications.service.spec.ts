import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationCategory, NotificationPriority } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../database/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// `create()` runs its work inside `withTenantContext(tenantId, cb)` so it can
// be called from fire-and-forget event listeners with no ambient request
// transaction; every other method calls `this.prisma.notification...`
// directly, matching every other service in this codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTx: Record<string, any> = {
  user: { findFirst: jest.fn() },
  notification: { create: jest.fn() },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: Record<string, any> = {
  withTenantContext: jest.fn((_tenantId: string, callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)),
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  const TENANT_ID = 'tenant-uuid-1';
  const OTHER_TENANT_ID = 'tenant-uuid-2';
  const USER_ID = 'user-uuid-1';
  const OTHER_USER_ID = 'user-uuid-2';
  const NOTIFICATION_ID = 'notification-uuid-1';

  const mockUser = { id: USER_ID, tenantId: TENANT_ID, deletedAt: null };

  const mockNotification = {
    id: NOTIFICATION_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    category: NotificationCategory.LEAVE,
    priority: NotificationPriority.NORMAL,
    title: 'Leave request approved',
    message: 'Your leave request has been approved.',
    isRead: false,
    readAt: null,
    resource: 'leave_request',
    resourceId: 'leave-request-uuid-1',
    metadata: {},
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  // ─── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a notification scoped to the given tenant and emits notification.created', async () => {
      mockTx.user.findFirst.mockResolvedValue(mockUser);
      mockTx.notification.create.mockResolvedValue(mockNotification);

      const result = await service.create(TENANT_ID, {
        userId: USER_ID,
        title: 'Leave request approved',
        message: 'Your leave request has been approved.',
        category: NotificationCategory.LEAVE,
        resource: 'leave_request',
        resourceId: 'leave-request-uuid-1',
      });

      expect(mockTx.user.findFirst).toHaveBeenCalledWith({
        where: { id: USER_ID, tenantId: TENANT_ID, deletedAt: null },
      });
      expect(mockTx.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID, category: NotificationCategory.LEAVE }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification.created',
        expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID, notificationId: NOTIFICATION_ID }),
      );
      expect(result).toEqual(mockNotification);
    });

    it('rejects a userId that does not belong to the given tenant', async () => {
      mockTx.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(OTHER_TENANT_ID, { userId: USER_ID, title: 'Title', message: 'Message' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockTx.notification.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('defaults category and priority when not provided', async () => {
      mockTx.user.findFirst.mockResolvedValue(mockUser);
      mockTx.notification.create.mockResolvedValue(mockNotification);

      await service.create(TENANT_ID, { userId: USER_ID, title: 'Title', message: 'Message' });

      expect(mockTx.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: NotificationCategory.SYSTEM,
            priority: NotificationPriority.NORMAL,
          }),
        }),
      );
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the notification when it belongs to the tenant and user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(mockNotification);

      const result = await service.findOne(TENANT_ID, USER_ID, NOTIFICATION_ID);

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: NOTIFICATION_ID, tenantId: TENANT_ID, userId: USER_ID },
      });
      expect(result).toEqual(mockNotification);
    });

    it("throws NotFoundException for another tenant's notification, even with the correct id", async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.findOne(OTHER_TENANT_ID, USER_ID, NOTIFICATION_ID)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException for another user's notification within the same tenant", async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.findOne(TENANT_ID, OTHER_USER_ID, NOTIFICATION_ID)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: NOTIFICATION_ID, tenantId: TENANT_ID, userId: OTHER_USER_ID },
      });
    });
  });

  // ─── markAsRead ─────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks an unread notification as read', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({ ...mockNotification, isRead: false });
      mockPrisma.notification.update.mockResolvedValue({ ...mockNotification, isRead: true, readAt: new Date() });

      const result = await service.markAsRead(TENANT_ID, USER_ID, NOTIFICATION_ID);

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: NOTIFICATION_ID },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result.isRead).toBe(true);
    });

    it('is a no-op (no update call) for an already-read notification', async () => {
      const alreadyRead = { ...mockNotification, isRead: true, readAt: new Date('2026-08-01') };
      mockPrisma.notification.findFirst.mockResolvedValue(alreadyRead);

      const result = await service.markAsRead(TENANT_ID, USER_ID, NOTIFICATION_ID);

      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
      expect(result).toEqual(alreadyRead);
    });

    it("cannot mark another user's notification as read", async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead(TENANT_ID, OTHER_USER_ID, NOTIFICATION_ID)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });
  });

  // ─── markAllAsRead ──────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read scoped to tenant and user only', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead(TENANT_ID, USER_ID);

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID, isRead: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  // ─── getUnreadCount ─────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('counts unread notifications scoped to tenant and user', async () => {
      mockPrisma.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(TENANT_ID, USER_ID);

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: USER_ID, isRead: false },
      });
      expect(result).toBe(5);
    });

    it('is independent per user within the same tenant', async () => {
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getUnreadCount(TENANT_ID, OTHER_USER_ID);

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userId: OTHER_USER_ID, isRead: false },
      });
    });
  });

  // ─── findMyNotifications ────────────────────────────────────────────────

  describe('findMyNotifications', () => {
    it('scopes the query to tenant and user and returns pagination meta', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([mockNotification]);
      mockPrisma.notification.count.mockResolvedValue(1);

      const query = { page: 1, limit: 20 } as unknown as QueryNotificationDto;
      const result = await service.findMyNotifications(TENANT_ID, USER_ID, query);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }) }),
      );
      expect(result.nodes).toEqual([mockNotification]);
      expect(result.meta.total).toBe(1);
    });

    it('applies category, priority, isRead, and resource filters when provided', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      const query = {
        page: 1,
        limit: 20,
        category: NotificationCategory.LEAVE,
        priority: NotificationPriority.HIGH,
        isRead: false,
        resource: 'leave_request',
      } as unknown as QueryNotificationDto;

      await service.findMyNotifications(TENANT_ID, USER_ID, query);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            userId: USER_ID,
            category: NotificationCategory.LEAVE,
            priority: NotificationPriority.HIGH,
            isRead: false,
            resource: 'leave_request',
          }),
        }),
      );
    });
  });
});
