import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { NotificationCategory, NotificationPriority } from '@prisma/client';
import { createPaginatedType } from '../../../common/types/pagination.types';

registerEnumType(NotificationCategory, {
  name: 'NotificationCategory',
  description: 'Category of a notification',
});

registerEnumType(NotificationPriority, {
  name: 'NotificationPriority',
  description: 'Priority of a notification',
});

@ObjectType()
export class NotificationType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  userId: string;

  @Field(() => NotificationCategory)
  category: NotificationCategory;

  @Field(() => NotificationPriority)
  priority: NotificationPriority;

  @Field()
  title: string;

  @Field()
  message: string;

  @Field()
  isRead: boolean;

  @Field({ nullable: true })
  readAt?: Date;

  @Field({ nullable: true })
  resource?: string;

  @Field({ nullable: true })
  resourceId?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class PaginatedNotificationType extends createPaginatedType(NotificationType) {}

/**
 * Internal contract for creating a notification, used directly by
 * event listeners (LeaveNotificationsListener today; future
 * AttendanceNotificationsListener / ShiftsNotificationsListener) without
 * going through NotificationsController/Resolver or any HTTP/GraphQL DTO.
 */
export interface NotifyInput {
  userId: string;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  title: string;
  message: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}
