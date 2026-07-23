import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Ip,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { ClockInDto, StartBreakDto } from './dto/clock-in.dto';
import { ClockOutDto, EndBreakDto, UpdateAttendanceDto, ManualEntryDto } from './dto/clock-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // ─── Employee: Clock In/Out ───────────────────────────────────────────────

  @Post('clock-in')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Clock in — starts an attendance session for the current user' })
  async clockIn(
    @Body() dto: ClockInDto,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.attendanceService.clockIn(tenantId, user.id, dto, ip, userAgent);
  }

  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clock out — ends the active session and calculates work duration' })
  async clockOut(
    @Body() dto: ClockOutDto,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.attendanceService.clockOut(tenantId, user.id, dto, ip, userAgent);
  }

  // ─── Employee: Breaks ─────────────────────────────────────────────────────

  @Post('break/start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a break during an active clock-in session' })
  async startBreak(
    @Body() dto: StartBreakDto,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.startBreak(tenantId, user.id, dto);
  }

  @Post('break/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the current break and resume the work session' })
  async endBreak(
    @Body() dto: EndBreakDto,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.endBreak(tenantId, user.id, dto);
  }

  // ─── Employee: Own Records ────────────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated user's attendance history" })
  async getMyAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Query() query: QueryAttendanceDto,
  ) {
    return this.attendanceService.findByUser(tenantId, user.id, query);
  }

  @Get('active-session')
  @ApiOperation({ summary: 'Get the current active clock-in session (includes break state if on break)' })
  async getActiveSession(
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.getActiveSession(tenantId, user.id);
  }

  // ─── HR / Admin: Attendance Records ──────────────────────────────────────

  @Get()
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  @ApiOperation({ summary: '[HR] List all attendance records in the tenant with filters' })
  async findAll(@TenantId() tenantId: string, @Query() query: QueryAttendanceDto) {
    return this.attendanceService.findAll(tenantId, query);
  }

  @Get('summary/daily')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  @ApiOperation({ summary: '[HR] Get daily attendance summary counts' })
  @ApiQuery({ name: 'date', required: true, description: 'Date in YYYY-MM-DD format' })
  async getDailySummary(
    @TenantId() tenantId: string,
    @Query('date') date: string,
  ) {
    return this.attendanceService.getDailySummary(tenantId, date);
  }

  @Get('policy')
  @ApiOperation({ summary: 'Get the attendance policy for this tenant' })
  async getPolicy(@TenantId() tenantId: string) {
    return this.attendanceService.getPolicy(tenantId);
  }

  @Get(':id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'read' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[HR] Get a single attendance record by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.findOne(tenantId, id);
  }

  // ─── HR / Admin: Mutations ────────────────────────────────────────────────

  @Post('manual')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'create' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[HR] Create a manual attendance entry for a user' })
  async createManualEntry(
    @Body() dto: ManualEntryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.createManualEntry(tenantId, dto, actor.id);
  }

  @Put(':id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'attendance', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[HR] Update an existing attendance record' })
  async updateRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.updateRecord(tenantId, id, dto, actor.id);
  }

  @Put('policy')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'attendance', action: 'manage' })
  @ApiOperation({ summary: '[Admin] Create or update the attendance policy for this tenant' })
  async upsertPolicy(
    @Body() dto: AttendancePolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    return this.attendanceService.upsertPolicy(tenantId, dto, actor.id);
  }
}
