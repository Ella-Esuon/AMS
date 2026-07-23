import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto, CreateBreakRuleDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { AssignShiftDto, UpdateAssignmentDto } from './dto/assign-shift.dto';
import { QueryShiftDto, QueryAssignmentDto } from './dto/query-shift.dto';
import { CreateRotationDto, UpsertRotationSlotDto } from './dto/shift-rotation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Shifts')
@Controller('shifts')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // ─── Shifts CRUD ──────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Create a new shift' })
  async create(
    @Body() dto: CreateShiftDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.create(tenantId, dto, user.id);
  }

  @Get()
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'List all shifts for the tenant' })
  async findAll(@Query() query: QueryShiftDto, @TenantId() tenantId: string) {
    return this.shiftsService.findAll(tenantId, query);
  }

  @Get('assignments')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'List shift assignments' })
  async getAssignments(@Query() query: QueryAssignmentDto, @TenantId() tenantId: string) {
    return this.shiftsService.getAssignments(tenantId, query);
  }

  @Get('assignments/:assignmentId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'Get a single shift assignment' })
  async getAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @TenantId() tenantId: string,
  ) {
    return this.shiftsService.getAssignment(tenantId, assignmentId);
  }

  @Get('rotations')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'List all rotations' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async getRotations(
    @TenantId() tenantId: string,
    @Query('isActive') isActive?: string,
  ) {
    const active = isActive === undefined ? undefined : isActive === 'true';
    return this.shiftsService.getRotations(tenantId, active);
  }

  @Get('rotations/:rotationId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'Get a rotation by ID' })
  async getRotation(
    @Param('rotationId', ParseUUIDPipe) rotationId: string,
    @TenantId() tenantId: string,
  ) {
    return this.shiftsService.getRotation(tenantId, rotationId);
  }

  @Get(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'Get a single shift by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.shiftsService.findOne(tenantId, id);
  }

  @Put(':id')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Update a shift' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.update(tenantId, id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Soft-delete a shift' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.remove(tenantId, id, user.id);
  }

  // ─── Break Rules ──────────────────────────────────────────────────────────

  @Post(':id/break-rules')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Add a break rule to a shift' })
  async addBreakRule(
    @Param('id', ParseUUIDPipe) shiftId: string,
    @Body() dto: CreateBreakRuleDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.addBreakRule(tenantId, shiftId, dto, user.id);
  }

  @Delete(':id/break-rules/:ruleId')
  @HttpCode(HttpStatus.OK)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Remove a break rule from a shift' })
  async removeBreakRule(
    @Param('id', ParseUUIDPipe) shiftId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.removeBreakRule(tenantId, shiftId, ruleId, user.id);
  }

  // ─── Shift Assignments ────────────────────────────────────────────────────

  @Post('assignments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'Assign a shift or rotation to a user' })
  async assignShift(
    @Body() dto: AssignShiftDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.assignShift(tenantId, dto, user.id);
  }

  @Patch('assignments/:assignmentId')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @ApiOperation({ summary: 'Update a shift assignment' })
  async updateAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateAssignmentDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.updateAssignment(tenantId, assignmentId, dto, user.id);
  }

  // ─── Rotations ────────────────────────────────────────────────────────────

  @Post('rotations')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Create a shift rotation' })
  async createRotation(
    @Body() dto: CreateRotationDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.createRotation(tenantId, dto, user.id);
  }

  @Put('rotations/:rotationId/slots')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiOperation({ summary: 'Upsert a slot in a rotation' })
  async upsertRotationSlot(
    @Param('rotationId', ParseUUIDPipe) rotationId: string,
    @Body() dto: UpsertRotationSlotDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shiftsService.upsertRotationSlot(tenantId, rotationId, dto, user.id);
  }
}
