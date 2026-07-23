import { Resolver, Query, Mutation, Args, Context, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto, CreateBreakRuleDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto, UpdateAssignmentDto } from './dto/assign-shift.dto';
import { QueryShiftDto, QueryAssignmentDto } from './dto/query-shift.dto';
import { CreateRotationDto, UpsertRotationSlotDto } from './dto/shift-rotation.dto';
import {
  ShiftType,
  ShiftBreakRuleType,
  ShiftAssignmentType,
  ShiftRotationType,
  ShiftRotationSlotType,
  EffectiveShiftType,
  PaginatedShiftsType,
  PaginatedAssignmentsType,
} from './types/shifts.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

interface GqlContext {
  req: { user: AuthenticatedUser; tenantId: string };
}

@Resolver(() => ShiftType)
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
export class ShiftsResolver {
  constructor(private readonly shiftsService: ShiftsService) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  @Query(() => PaginatedShiftsType, { name: 'shifts' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shifts(
    @Args('query', { type: () => QueryShiftDto, nullable: true }) query: QueryShiftDto = {} as QueryShiftDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.findAll(ctx.req.tenantId, query);
  }

  @Query(() => ShiftType, { name: 'shift' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shift(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.findOne(ctx.req.tenantId, id);
  }

  @Query(() => PaginatedAssignmentsType, { name: 'shiftAssignments' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shiftAssignments(
    @Args('query', { type: () => QueryAssignmentDto, nullable: true }) query: QueryAssignmentDto = {} as QueryAssignmentDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.getAssignments(ctx.req.tenantId, query);
  }

  @Query(() => ShiftAssignmentType, { name: 'shiftAssignment' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shiftAssignment(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.getAssignment(ctx.req.tenantId, id);
  }

  @Query(() => [ShiftRotationType], { name: 'shiftRotations' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shiftRotations(
    @Context() ctx: GqlContext,
    @Args('isActive', { type: () => Boolean, nullable: true }) isActive?: boolean,
  ) {
    return this.shiftsService.getRotations(ctx.req.tenantId, isActive);
  }

  @Query(() => ShiftRotationType, { name: 'shiftRotation' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async shiftRotation(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.getRotation(ctx.req.tenantId, id);
  }

  @Query(() => EffectiveShiftType, { name: 'effectiveShift', nullable: true })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async effectiveShift(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('date', { type: () => String, description: 'YYYY-MM-DD' }) date: string,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.getEffectiveShift(ctx.req.tenantId, userId, new Date(date));
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  @Mutation(() => ShiftType, { name: 'createShift' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async createShift(
    @Args('input', { type: () => CreateShiftDto }) input: CreateShiftDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.create(ctx.req.tenantId, input, ctx.req.user.id);
  }

  @Mutation(() => ShiftType, { name: 'updateShift' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async updateShift(
    @Args('id', { type: () => ID }) id: string,
    @Args('input', { type: () => UpdateShiftDto }) input: UpdateShiftDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.update(ctx.req.tenantId, id, input, ctx.req.user.id);
  }

  @Mutation(() => Boolean, { name: 'deleteShift' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN)
  async deleteShift(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GqlContext,
  ) {
    const result = await this.shiftsService.remove(ctx.req.tenantId, id, ctx.req.user.id);
    return result.success;
  }

  @Mutation(() => ShiftBreakRuleType, { name: 'addShiftBreakRule' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async addShiftBreakRule(
    @Args('shiftId', { type: () => ID }) shiftId: string,
    @Args('input', { type: () => CreateBreakRuleDto }) input: CreateBreakRuleDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.addBreakRule(ctx.req.tenantId, shiftId, input, ctx.req.user.id);
  }

  @Mutation(() => Boolean, { name: 'removeShiftBreakRule' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async removeShiftBreakRule(
    @Args('shiftId', { type: () => ID }) shiftId: string,
    @Args('ruleId', { type: () => ID }) ruleId: string,
    @Context() ctx: GqlContext,
  ) {
    const result = await this.shiftsService.removeBreakRule(ctx.req.tenantId, shiftId, ruleId, ctx.req.user.id);
    return result.success;
  }

  @Mutation(() => ShiftAssignmentType, { name: 'assignShift' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async assignShift(
    @Args('input', { type: () => AssignShiftDto }) input: AssignShiftDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.assignShift(ctx.req.tenantId, input, ctx.req.user.id);
  }

  @Mutation(() => ShiftAssignmentType, { name: 'updateShiftAssignment' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  async updateShiftAssignment(
    @Args('id', { type: () => ID }) id: string,
    @Args('input', { type: () => UpdateAssignmentDto }) input: UpdateAssignmentDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.updateAssignment(ctx.req.tenantId, id, input, ctx.req.user.id);
  }

  @Mutation(() => ShiftRotationType, { name: 'createShiftRotation' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async createShiftRotation(
    @Args('input', { type: () => CreateRotationDto }) input: CreateRotationDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.createRotation(ctx.req.tenantId, input, ctx.req.user.id);
  }

  @Mutation(() => ShiftRotationSlotType, { name: 'upsertRotationSlot' })
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  async upsertRotationSlot(
    @Args('rotationId', { type: () => ID }) rotationId: string,
    @Args('input', { type: () => UpsertRotationSlotDto }) input: UpsertRotationSlotDto,
    @Context() ctx: GqlContext,
  ) {
    return this.shiftsService.upsertRotationSlot(ctx.req.tenantId, rotationId, input, ctx.req.user.id);
  }
}
