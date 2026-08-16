import { Resolver, Query, Mutation, Args, Context, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { NotificationType, PaginatedNotificationType } from './types/notifications.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

interface GqlContext {
  req: { user: AuthenticatedUser; tenantId: string };
}

@Resolver(() => NotificationType)
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  @Query(() => PaginatedNotificationType, { name: 'myNotifications' })
  async myNotifications(
    @Args('query', { type: () => QueryNotificationDto, nullable: true }) query: QueryNotificationDto = {} as QueryNotificationDto,
    @Context() ctx: GqlContext,
  ) {
    return this.notificationsService.findMyNotifications(ctx.req.tenantId, ctx.req.user.id, query);
  }

  @Query(() => Int, { name: 'myUnreadNotificationCount' })
  async myUnreadNotificationCount(@Context() ctx: GqlContext) {
    return this.notificationsService.getUnreadCount(ctx.req.tenantId, ctx.req.user.id);
  }

  @Query(() => NotificationType, { name: 'notification' })
  async notification(@Args('id', { type: () => ID }) id: string, @Context() ctx: GqlContext) {
    return this.notificationsService.findOne(ctx.req.tenantId, ctx.req.user.id, id);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  @Mutation(() => NotificationType, { name: 'markNotificationAsRead' })
  async markNotificationAsRead(@Args('id', { type: () => ID }) id: string, @Context() ctx: GqlContext) {
    return this.notificationsService.markAsRead(ctx.req.tenantId, ctx.req.user.id, id);
  }

  @Mutation(() => Int, { name: 'markAllNotificationsAsRead' })
  async markAllNotificationsAsRead(@Context() ctx: GqlContext) {
    const result = await this.notificationsService.markAllAsRead(ctx.req.tenantId, ctx.req.user.id);
    return result.count;
  }

  @Mutation(() => NotificationType, { name: 'sendNotification' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'notifications', action: 'manage' })
  async sendNotification(@Args('input') input: CreateNotificationDto, @Context() ctx: GqlContext) {
    return this.notificationsService.create(ctx.req.tenantId, input);
  }
}
