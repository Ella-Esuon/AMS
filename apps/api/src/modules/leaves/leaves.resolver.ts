import { Resolver, Query, Mutation, Args, Context, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { QueryLeaveTypeDto } from './dto/query-leave-type.dto';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';
import { QueryLeaveRequestDto } from './dto/query-leave-request.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-balance.dto';
import {
  LeaveTypeType,
  LeaveBalanceType,
  LeaveRequestType,
  PaginatedLeaveTypeType,
  PaginatedLeaveRequestType,
} from './types/leaves.types';
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

@Resolver(() => LeaveRequestType)
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
export class LeavesResolver {
  constructor(private readonly leavesService: LeavesService) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  @Query(() => PaginatedLeaveRequestType, { name: 'myLeaveRequests' })
  async myLeaveRequests(
    @Args('query', { type: () => QueryLeaveRequestDto, nullable: true }) query: QueryLeaveRequestDto = {} as QueryLeaveRequestDto,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.findMyRequests(ctx.req.tenantId, ctx.req.user.id, query);
  }

  @Query(() => [LeaveBalanceType], { name: 'myLeaveBalances' })
  async myLeaveBalances(
    @Args('year', { type: () => Int, nullable: true }) year: number | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.getMyBalances(ctx.req.tenantId, ctx.req.user.id, year);
  }

  @Query(() => PaginatedLeaveTypeType, { name: 'leaveTypes' })
  async leaveTypes(
    @Args('query', { type: () => QueryLeaveTypeDto, nullable: true }) query: QueryLeaveTypeDto = {} as QueryLeaveTypeDto,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.findAllLeaveTypes(ctx.req.tenantId, query);
  }

  @Query(() => PaginatedLeaveRequestType, { name: 'leaveRequests' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'read' })
  async leaveRequests(
    @Args('query', { type: () => QueryLeaveRequestDto, nullable: true }) query: QueryLeaveRequestDto = {} as QueryLeaveRequestDto,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.findAllRequests(ctx.req.tenantId, query);
  }

  @Query(() => LeaveRequestType, { name: 'leaveRequest' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'read' })
  async leaveRequest(@Args('id', { type: () => ID }) id: string, @Context() ctx: GqlContext) {
    return this.leavesService.findOneRequest(ctx.req.tenantId, id);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  @Mutation(() => LeaveRequestType, { name: 'submitLeaveRequest' })
  async submitLeaveRequest(@Args('input') input: CreateLeaveRequestDto, @Context() ctx: GqlContext) {
    return this.leavesService.submitRequest(ctx.req.tenantId, ctx.req.user.id, input);
  }

  @Mutation(() => LeaveRequestType, { name: 'cancelMyLeaveRequest' })
  async cancelMyLeaveRequest(@Args('id', { type: () => ID }) id: string, @Context() ctx: GqlContext) {
    return this.leavesService.cancelOwnRequest(ctx.req.tenantId, id, ctx.req.user.id);
  }

  @Mutation(() => LeaveRequestType, { name: 'reviewLeaveRequest' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'approve' })
  async reviewLeaveRequest(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ReviewLeaveRequestDto,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.reviewRequest(ctx.req.tenantId, id, input, ctx.req.user.id);
  }

  @Mutation(() => LeaveTypeType, { name: 'createLeaveType' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  async createLeaveType(@Args('input') input: CreateLeaveTypeDto, @Context() ctx: GqlContext) {
    return this.leavesService.createLeaveType(ctx.req.tenantId, input, ctx.req.user.id);
  }

  @Mutation(() => LeaveTypeType, { name: 'updateLeaveType' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  async updateLeaveType(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLeaveTypeDto,
    @Context() ctx: GqlContext,
  ) {
    return this.leavesService.updateLeaveType(ctx.req.tenantId, id, input, ctx.req.user.id);
  }

  @Mutation(() => LeaveBalanceType, { name: 'adjustLeaveBalance' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'leaves', action: 'manage' })
  async adjustLeaveBalance(@Args('input') input: AdjustLeaveBalanceDto, @Context() ctx: GqlContext) {
    return this.leavesService.adjustBalance(ctx.req.tenantId, input, ctx.req.user.id);
  }
}
