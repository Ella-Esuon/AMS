import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, NotificationCategory, NotificationPriority } from '@prisma/client';
import { parseISO, startOfDay, endOfDay } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { NotifyInput } from './types/notifications.types';
import { buildPaginationMeta, buildPrismaSkipTake } from '../../common/types/pagination.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Generic entrypoint for creating a notification. Callable from the admin
   * REST/GraphQL surface as well as directly from other modules' event
   * listeners (see LeaveNotificationsListener) — the only integration point
   * a future Attendance/Shifts listener needs.
   *
   * This method (and every other one below) opens its own tenant-scoped
   * transaction via `withTenantContext(tenantId, ...)` rather than relying on
   * the ambient per-HTTP-request transaction that every other service in
   * this codebase implicitly depends on via PrismaService's proxy. That
   * ambient transaction is only guaranteed to be open for the lifetime of
   * one HTTP request; this service is also invoked from fire-and-forget
   * event listeners whose async continuation isn't guaranteed to still be
   * inside it, so `app.current_tenant_id` is set explicitly every call
   * instead of assuming one is already active.
   */
  async create(tenantId: string, params: NotifyInput) {
    const notification = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: params.userId, tenantId, deletedAt: null },
      });
      if (!user) throw new NotFoundException('User not found in this tenant');

      return tx.notification.create({
        data: {
          tenantId,
          userId: params.userId,
          category: params.category ?? NotificationCategory.SYSTEM,
          priority: params.priority ?? NotificationPriority.NORMAL,
          title: params.title,
          message: params.message,
          resource: params.resource ?? null,
          resourceId: params.resourceId ?? null,
          metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    });

    this.eventEmitter.emit('notification.created', {
      tenantId,
      userId: params.userId,
      notificationId: notification.id,
      category: notification.category,
    });

    return notification;
  }

  async findMyNotifications(tenantId: string, userId: string, query: QueryNotificationDto) {
    const {
      page, limit, category, priority, isRead, resource, startDate, endDate,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = query;
    const { skip, take } = buildPrismaSkipTake(page, limit);

    const where: Prisma.NotificationWhereInput = {
      tenantId,
      userId,
      ...(category && { category }),
      ...(priority && { priority }),
      ...(isRead !== undefined && { isRead }),
      ...(resource && { resource }),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: startOfDay(parseISO(startDate)) }),
          ...(endDate && { lte: endOfDay(parseISO(endDate)) }),
        },
      }),
    };

    const [nodes, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { nodes, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, userId: string, id: string) {
    // Ownership is enforced here in the service layer (tenantId + userId in
    // the WHERE clause) — RLS on this table only guarantees tenant isolation,
    // matching every other tenant-scoped table in this codebase.
    const notification = await this.prisma.notification.findFirst({ where: { id, tenantId, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async markAsRead(tenantId: string, userId: string, id: string) {
    const existing = await this.findOne(tenantId, userId, id);
    if (existing.isRead) return existing;

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllAsRead(tenantId: string, userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { count: result.count };
  }

  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { tenantId, userId, isRead: false } });
  }
}
