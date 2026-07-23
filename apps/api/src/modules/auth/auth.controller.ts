import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Ip,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, ChangePasswordDto } from './dto/register.dto';
import { RefreshTokenDto, VerifyMfaDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { Public } from '../../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Login ────────────────────────────────────────────────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiHeader({ name: 'X-Tenant-ID', description: 'Tenant identifier', required: true })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @TenantId() tenantId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, tenantId, ip, userAgent);
  }

  // ─── MFA Verify ───────────────────────────────────────────────────────────

  @Post('mfa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify MFA code after login' })
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.verifyMfaAndLogin(dto, ip, userAgent);
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiHeader({ name: 'X-Tenant-ID', description: 'Tenant identifier', required: true })
  async register(@Body() dto: RegisterDto, @TenantId() tenantId: string) {
    return this.authService.register(dto, tenantId);
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto, ip);
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Request() req: { headers: { authorization?: string }; body: { refreshToken?: string } },
  ) {
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.authService.logout(user.id, accessToken, req.body?.refreshToken);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // ─── MFA Setup ────────────────────────────────────────────────────────────

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate MFA setup — returns QR code and secret' })
  async setupMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupMfa(user.id, user.tenantId);
  }

  @Post('mfa/confirm')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm MFA setup with TOTP code' })
  async confirmMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { code: string },
  ) {
    return this.authService.confirmMfaSetup(user.id, user.tenantId, body.code);
  }

  // ─── Password ─────────────────────────────────────────────────────────────

  @Post('change-password')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('JWT')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Change user password' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, user.tenantId, dto);
  }
}
