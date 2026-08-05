import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { QueryLeaveTypeDto } from './dto/query-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';
import { QueryLeaveRequestDto } from './dto/query-leave-request.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-balance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Leaves')
@Controller('leaves')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  // ─── Employee: My Requests & Balances ────────────────────────────────────

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a leave request for the current user' })
  async submitRequest(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.submitRequest(tenantId, user.id, dto);
  }

  @Get('requests/me')
  @ApiOperation({ summary: "Get the authenticated user's leave requests" })
  async getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Query() query: QueryLeaveRequestDto,
  ) {
    return this.leavesService.findMyRequests(tenantId, user.id, query);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'Cancel one of your own pending leave requests' })
  @ApiParam({ name: 'id', type: String })
  async cancelMyRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.cancelOwnRequest(tenantId, id, user.id);
  }

  @Get('balances/me')
  @ApiOperation({ summary: "Get the authenticated user's leave balances" })
  @ApiQuery({ name: 'year', required: false, type: Number })
  async getMyBalances(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Query('year') year?: string,
  ) {
    return this.leavesService.getMyBalances(tenantId, user.id, year ? Number(year) : undefined);
  }

  // ─── Leave Types ──────────────────────────────────────────────────────────

  @Post('types')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  @ApiOperation({ summary: '[Admin] Create a leave type' })
  async createLeaveType(
    @Body() dto: CreateLeaveTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.createLeaveType(tenantId, dto, actor.id);
  }

  @Get('types')
  @ApiOperation({ summary: 'List leave types available in this tenant' })
  async findAllLeaveTypes(@Query() query: QueryLeaveTypeDto, @TenantId() tenantId: string) {
    return this.leavesService.findAllLeaveTypes(tenantId, query);
  }

  @Get('types/:id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get a single leave type by ID' })
  async findLeaveType(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.leavesService.findLeaveType(tenantId, id);
  }

  @Put('types/:id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[Admin] Update a leave type' })
  async updateLeaveType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.updateLeaveType(tenantId, id, dto, actor.id);
  }

  @Delete('types/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[Admin] Soft-delete a leave type' })
  async removeLeaveType(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.removeLeaveType(tenantId, id, actor.id);
  }

  // ─── HR / Admin: Leave Requests ───────────────────────────────────────────

  @Get('requests')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'read' })
  @ApiOperation({ summary: '[HR] List all leave requests in the tenant with filters' })
  async findAllRequests(@Query() query: QueryLeaveRequestDto, @TenantId() tenantId: string) {
    return this.leavesService.findAllRequests(tenantId, query);
  }

  @Get('requests/:id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'read' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[HR] Get a single leave request by ID' })
  async findOneRequest(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.leavesService.findOneRequest(tenantId, id);
  }

  @Put('requests/:id/review')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'approve' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[HR] Approve or reject a pending leave request' })
  async reviewRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.reviewRequest(tenantId, id, dto, actor.id);
  }

  @Post('requests/:id/cancel-as-admin')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[HR] Cancel a pending or already-approved leave request on behalf of a user' })
  async cancelRequestAsAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.cancelRequest(tenantId, id, actor.id);
  }

  @Put('balances/adjust')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  @ApiOperation({ summary: "[HR] Adjust a user's leave balance for a given year" })
  async adjustBalance(
    @Body() dto: AdjustLeaveBalanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.leavesService.adjustBalance(tenantId, dto, actor.id);
  }
}
