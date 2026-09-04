import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LeaveRequestStatus, NotificationCategory, NotificationPriority } from '@prisma/client';
import { NotificationsService } from '../notifications.service';
import { NotifyInput } from '../types/notifications.types';

interface LeaveRequestedEvent {
  tenantId: string;
  userId: string;
  requestId: string;
  status: LeaveRequestStatus;
}

interface LeaveApprovedEvent {
  tenantId: string;
  userId: string;
  requestId: string;
  actorId?: string;
  autoApproved?: boolean;
}

interface LeaveRejectedEvent {
  tenantId: string;
  userId: string;
  requestId: string;
  actorId: string;
}

interface LeaveCancelledEvent {
  tenantId: string;
  userId: string;
  requestId: string;
  actorId: string;
  previousStatus: LeaveRequestStatus;
}

/**
 * Bridges Leave Management domain events to per-user notifications. Depends
 * only on the event payloads LeavesService emits — no import of LeavesModule,
 * LeavesService, or any leave Prisma model — so Leave Management stays
 * unaware notifications exist (the intended direction of coupling).
 */
@Injectable()
export class LeaveNotificationsListener {
  private readonly logger = new Logger(LeaveNotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('leave.requested')
  async onLeaveRequested(event: LeaveRequestedEvent): Promise<void> {
    // Auto-approved requests get their own leave.approved event (emitted
    // right after this one) — skip here to avoid a duplicate notification.
    if (event.status === LeaveRequestStatus.APPROVED) return;

    await this.notify(event.tenantId, event.userId, {
      category: NotificationCategory.LEAVE,
      priority: NotificationPriority.NORMAL,
      title: 'Leave request submitted',
      message: 'Your leave request has been submitted and is pending approval.',
      resource: 'leave_request',
      resourceId: event.requestId,
      metadata: { status: event.status },
    });
  }

  @OnEvent('leave.approved')
  async onLeaveApproved(event: LeaveApprovedEvent): Promise<void> {
    await this.notify(event.tenantId, event.userId, {
      category: NotificationCategory.LEAVE,
      priority: NotificationPriority.NORMAL,
      title: 'Leave request approved',
      message: event.autoApproved
        ? 'Your leave request was automatically approved.'
        : 'Your leave request has been approved.',
      resource: 'leave_request',
      resourceId: event.requestId,
      metadata: { actorId: event.actorId ?? null, autoApproved: !!event.autoApproved },
    });
  }

  @OnEvent('leave.rejected')
  async onLeaveRejected(event: LeaveRejectedEvent): Promise<void> {
    await this.notify(event.tenantId, event.userId, {
      category: NotificationCategory.LEAVE,
      priority: NotificationPriority.HIGH,
      title: 'Leave request rejected',
      message: 'Your leave request has been rejected.',
      resource: 'leave_request',
      resourceId: event.requestId,
      metadata: { actorId: event.actorId },
    });
  }

  @OnEvent('leave.cancelled')
  async onLeaveCancelled(event: LeaveCancelledEvent): Promise<void> {
    // Only cancelling a request that was already approved reverses something
    // the user was relying on; cancelling a still-pending request isn't
    // notification-worthy. This is why leave.cancelled carries previousStatus.
    if (event.previousStatus !== LeaveRequestStatus.APPROVED) return;

    await this.notify(event.tenantId, event.userId, {
      category: NotificationCategory.LEAVE,
      priority: NotificationPriority.HIGH,
      title: 'Approved leave cancelled',
      message: 'Your approved leave request has been cancelled.',
      resource: 'leave_request',
      resourceId: event.requestId,
      metadata: { actorId: event.actorId, previousStatus: event.previousStatus },
    });
  }

  private async notify(tenantId: string, userId: string, params: Omit<NotifyInput, 'userId'>): Promise<void> {
    try {
      await this.notifications.create(tenantId, { userId, ...params });
    } catch (error) {
      // EventEmitter2's default emit() is fire-and-forget for async
      // listeners — an uncaught rejection here would surface as an
      // unhandled promise rejection rather than failing the leave action
      // that triggered it, so it must never propagate out of this method.
      this.logger.error(`Failed to create leave notification for user=${userId}`, error as Error);
    }
  }
}
