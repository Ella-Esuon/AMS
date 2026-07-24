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
import { TenantsService } from './tenants.service';
import { CreateTenantDto, RegisterTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto, UpdateTenantStatusDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Roles, SystemRole } from '../../common/decorators/roles.decorator';
import { Public, SkipTenantCheck } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationArgs } from '../../common/types/pagination.types';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  // ─── Public: Self-Registration ────────────────────────────────────────────

  @Post('register')
  @Public()
  @SkipTenantCheck()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new tenant organization (self-service)' })
  async register(@Body() dto: RegisterTenantDto) {
    return this.tenantsService.registerTenant(dto);
  }

  // ─── Super Admin: Manage All Tenants ──────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN)
  @SkipTenantCheck()
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: '[SuperAdmin] List all tenants' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  async findAll(@Query() args: PaginationArgs) {
    return this.tenantsService.findAll(args);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN)
  @SkipTenantCheck()
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[SuperAdmin] Create a tenant' })
  async create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get tenant by ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Tenant admins can only see their own tenant
    const tenantId = user.roles.includes('super_admin') ? id : user.tenantId;
    return this.tenantsService.findOne(tenantId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN)
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Update tenant settings' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = user.roles.includes('super_admin') ? id : user.tenantId;
    return this.tenantsService.update(tenantId, dto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN)
  @SkipTenantCheck()
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[SuperAdmin] Update tenant status' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.tenantsService.updateStatus(id, dto);
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.TENANT_ADMIN, SystemRole.HR_MANAGER)
  @ApiBearerAuth('JWT')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get tenant statistics' })
  async getStats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = user.roles.includes('super_admin') ? id : user.tenantId;
    return this.tenantsService.getStats(tenantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles(SystemRole.SUPER_ADMIN)
  @SkipTenantCheck()
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: '[SuperAdmin] Soft-delete a tenant' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.softDelete(id);
  }
}
