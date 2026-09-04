import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ─── Employee: My Notifications ──────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List the authenticated user's notifications" })
  async findMy(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Query() query: QueryNotificationDto,
  ) {
    return this.notificationsService.findMyNotifications(tenantId, user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "Get the authenticated user's unread notification count" })
  async unreadCount(@CurrentUser() user: AuthenticatedUser, @TenantId() tenantId: string) {
    const count = await this.notificationsService.getUnreadCount(tenantId, user.id);
    return { count };
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get a single notification by ID (own only)' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.findOne(tenantId, user.id, id);
  }

  @Post(':id/read')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Mark one notification as read (own only)' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.markAsRead(tenantId, user.id, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read for the current user' })
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser, @TenantId() tenantId: string) {
    return this.notificationsService.markAllAsRead(tenantId, user.id);
  }

  // ─── Admin: Send Notification ────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'notifications', action: 'manage' })
  @ApiOperation({ summary: '[Admin] Send a notification to a specific user in this tenant' })
  async sendNotification(@Body() dto: CreateNotificationDto, @TenantId() tenantId: string) {
    return this.notificationsService.create(tenantId, dto);
  }
}
