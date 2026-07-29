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
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, InviteUserDto } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard, PermissionsGuard)
@ApiBearerAuth('JWT')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'read' })
  @ApiOperation({ summary: 'List all users in tenant' })
  async findAll(@TenantId() tenantId: string, @Query() query: QueryUsersDto) {
    return this.usersService.findAll(tenantId, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own user profile' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findOne(user.id, user.tenantId);
  }

  @Get(':id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER, SystemRole.DEPARTMENT_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'read' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.usersService.findOne(id, tenantId);
  }

  @Post()
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'create' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  async create(
    @Body() dto: CreateUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.create(tenantId, dto, user.id);
  }

  @Post('invite')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'invite' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a user via email' })
  async invite(
    @Body() dto: InviteUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.invite(tenantId, dto, user.id);
  }

  @Put(':id')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Update user details' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, tenantId, dto, user.id);
  }

  @Put('me/profile')
  @ApiOperation({ summary: 'Update own profile' })
  async updateOwnProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user.id, user.tenantId, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @RequirePermissions({ resource: 'users', action: 'update' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Update user status (activate, suspend, etc.)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.updateStatus(id, tenantId, dto, user.id);
  }

  @Post(':id/roles')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'assign' })
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Assign roles to a user' })
  async assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { roleIds: string[] },
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.assignRoles(id, tenantId, body.roleIds, user.id);
  }

  @Delete(':id/roles/:roleId')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'roles', action: 'assign' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'roleId', type: String })
  @ApiOperation({ summary: 'Revoke a role from a user' })
  async revokeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.revokeRole(id, tenantId, roleId, user.id);
  }

  @Delete(':id')
  @Roles(SystemRole.TENANT_ADMIN)
  @RequirePermissions({ resource: 'users', action: 'delete' })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Soft-delete a user' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.softDelete(id, tenantId, user.id);
  }
}
