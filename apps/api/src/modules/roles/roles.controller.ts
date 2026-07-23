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
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  CreatePermissionDto,
  CreatePolicyDto,
} from './dto/create-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions, SkipTenantCheck } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { PaginationArgs } from '../../common/types/pagination.types';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Roles')
@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // ─── Roles ────────────────────────────────────────────────────────────────

  @Get()
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'roles', action: 'read' })
  @ApiOperation({ summary: 'List all roles in tenant' })
  async findAll(@TenantId() tenantId: string, @Query() args: PaginationArgs) {
    return this.rolesService.findAllRoles(tenantId, args);
  }

  @Get(':id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'roles', action: 'read' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get role by ID with permissions' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.rolesService.findOneRole(id, tenantId);
  }

  @Post()
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'create' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new role' })
  async create(
    @Body() dto: CreateRoleDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.createRole(tenantId, dto, user.id);
  }

  @Put(':id')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Update a role' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @TenantId() tenantId: string,
  ) {
    return this.rolesService.updateRole(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'delete' })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Delete a role' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.rolesService.deleteRole(id, tenantId);
  }

  // ─── Role Permissions ─────────────────────────────────────────────────────

  @Post(':id/permissions')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Assign permissions to a role' })
  async assignPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.assignPermissionsToRole(id, tenantId, dto, user.id);
  }

  @Delete(':id/permissions/:permissionId')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'permissionId', type: String })
  @ApiOperation({ summary: 'Remove permission from role' })
  async revokePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @TenantId() tenantId: string,
  ) {
    return this.rolesService.revokePermissionFromRole(id, tenantId, permissionId);
  }

  // ─── Permissions Catalog ──────────────────────────────────────────────────

  @Get('permissions/catalog')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.SUPER_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'read' })
  @ApiOperation({ summary: 'Get all available permissions' })
  @ApiQuery({ name: 'category', required: false, type: String })
  async getPermissions(@Query() args: PaginationArgs, @Query('category') category?: string) {
    return this.rolesService.findAllPermissions(args, category);
  }

  @Post('permissions')
  @Roles(SystemRole.SUPER_ADMIN)
  @SkipTenantCheck()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[SuperAdmin] Create a new permission' })
  async createPermission(@Body() dto: CreatePermissionDto) {
    return this.rolesService.createPermission(dto);
  }

  // ─── ABAC Policies ────────────────────────────────────────────────────────

  @Get('policies')
  @Roles(SystemRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get ABAC policies for tenant' })
  async getPolicies(
    @TenantId() tenantId: string,
    @Query('userId') userId?: string,
  ) {
    return this.rolesService.findPolicies(tenantId, userId);
  }

  @Post('policies')
  @Roles(SystemRole.TENANT_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create ABAC policy' })
  async createPolicy(
    @Body() dto: CreatePolicyDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.createPolicy(tenantId, dto, user.id);
  }

  @Delete('policies/:id')
  @Roles(SystemRole.TENANT_ADMIN)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Delete ABAC policy' })
  async deletePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.rolesService.deletePolicy(id, tenantId);
  }
}
