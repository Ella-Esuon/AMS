import { Resolver, Query, Mutation, Args, Context, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ClockInDto, StartBreakDto } from './dto/clock-in.dto';
import { ClockOutDto, EndBreakDto, UpdateAttendanceDto, ManualEntryDto } from './dto/clock-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import {
  AttendanceRecordType,
  AttendanceBreakType,
  AttendancePolicyType,
  ActiveSessionType,
  PaginatedAttendanceType,
  AttendanceDailySummaryType,
} from './types/attendance.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

interface GqlContext {
  req: { user: AuthenticatedUser; tenantId: string; ip?: string };
}

@Resolver(() => AttendanceRecordType)
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
export class AttendanceResolver {
  constructor(private readonly attendanceService: AttendanceService) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  @Query(() => PaginatedAttendanceType, { name: 'myAttendance' })
  async myAttendance(
    @Args('query', { type: () => QueryAttendanceDto, nullable: true }) query: QueryAttendanceDto = {} as QueryAttendanceDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.findByUser(ctx.req.tenantId, ctx.req.user.id, query);
  }

  @Query(() => ActiveSessionType, { name: 'myActiveSession', nullable: true })
  async myActiveSession(@Context() ctx: GqlContext) {
    return this.attendanceService.getActiveSession(ctx.req.tenantId, ctx.req.user.id);
  }

  @Query(() => PaginatedAttendanceType, { name: 'attendances' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async attendances(
    @Args('query', { type: () => QueryAttendanceDto, nullable: true }) query: QueryAttendanceDto = {} as QueryAttendanceDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.findAll(ctx.req.tenantId, query);
  }

  @Query(() => AttendanceRecordType, { name: 'attendance' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async attendance(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.findOne(ctx.req.tenantId, id);
  }

  @Query(() => AttendancePolicyType, { name: 'attendancePolicy' })
  async attendancePolicy(@Context() ctx: GqlContext) {
    return this.attendanceService.getPolicy(ctx.req.tenantId);
  }

  @Query(() => AttendanceDailySummaryType, { name: 'attendanceDailySummary' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  async attendanceDailySummary(
    @Args('date', { type: () => String }) date: string,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.getDailySummary(ctx.req.tenantId, date);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  @Mutation(() => AttendanceRecordType, { name: 'clockIn' })
  async clockIn(
    @Args('input', { type: () => ClockInDto, nullable: true }) input: ClockInDto = {} as ClockInDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.clockIn(ctx.req.tenantId, ctx.req.user.id, input, ctx.req.ip);
  }

  @Mutation(() => AttendanceRecordType, { name: 'clockOut' })
  async clockOut(
    @Args('input', { type: () => ClockOutDto, nullable: true }) input: ClockOutDto = {} as ClockOutDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.clockOut(ctx.req.tenantId, ctx.req.user.id, input, ctx.req.ip);
  }

  @Mutation(() => AttendanceBreakType, { name: 'startBreak' })
  async startBreak(
    @Args('input', { type: () => StartBreakDto, nullable: true }) input: StartBreakDto = {} as StartBreakDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.startBreak(ctx.req.tenantId, ctx.req.user.id, input);
  }

  @Mutation(() => AttendanceBreakType, { name: 'endBreak' })
  async endBreak(
    @Args('input', { type: () => EndBreakDto, nullable: true }) input: EndBreakDto = {} as EndBreakDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.endBreak(ctx.req.tenantId, ctx.req.user.id, input);
  }

  @Mutation(() => AttendanceRecordType, { name: 'createManualAttendance' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'create' })
  async createManualAttendance(
    @Args('input') input: ManualEntryDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.createManualEntry(ctx.req.tenantId, input, ctx.req.user.id);
  }

  @Mutation(() => AttendanceRecordType, { name: 'updateAttendanceRecord' })
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'update' })
  async updateAttendanceRecord(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateAttendanceDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.updateRecord(ctx.req.tenantId, id, input, ctx.req.user.id);
  }

  @Mutation(() => AttendancePolicyType, { name: 'upsertAttendancePolicy' })
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'attendance', action: 'manage' })
  async upsertAttendancePolicy(
    @Args('input') input: AttendancePolicyDto,
    @Context() ctx: GqlContext,
  ) {
    return this.attendanceService.upsertPolicy(ctx.req.tenantId, input, ctx.req.user.id);
  }
}
