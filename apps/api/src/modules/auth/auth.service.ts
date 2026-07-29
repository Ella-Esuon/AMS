import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, ChangePasswordDto } from './dto/register.dto';
import { RefreshTokenDto, VerifyMfaDto } from './dto/refresh-token.dto';
import {
  LoginResponse,
  RegisterResponse,
  MfaSetupResponse,
  RefreshTokenResponse,
  MessageResponse,
} from './types/auth.types';
import { JwtPayload } from '../../common/types/request.types';

const BCRYPT_ROUNDS = 12;
const MFA_TOKEN_TTL = 300; // 5 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient | null;
  private readonly useCognito: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const cognitoPoolId = config.get<string>('aws.cognito.userPoolId');
    this.useCognito = Boolean(cognitoPoolId && cognitoPoolId !== 'us-east-1_xxxxxxxx');

    if (this.useCognito) {
      this.cognitoClient = new CognitoIdentityProviderClient({
        region: config.get<string>('aws.region'),
        credentials: {
          accessKeyId: config.get<string>('aws.accessKeyId', ''),
          secretAccessKey: config.get<string>('aws.secretAccessKey', ''),
        },
      });
    } else {
      this.cognitoClient = null;
      this.logger.warn('Cognito not configured — using local JWT auth');
    }
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    tenantId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResponse> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, tenantId, deletedAt: null },
      include: {
        userRoles: {
          where: { isActive: true },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      await this.recordFailedLogin(dto.email, tenantId);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account status
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account has been suspended. Contact your administrator.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Account is temporarily locked until ${user.lockedUntil.toISOString()}. Too many failed attempts.`,
      );
    }

    // Verify password
    const isValidPassword = await this.verifyPassword(dto.password, user, tenantId);
    if (!isValidPassword) {
      await this.handleFailedLogin(user.id, tenantId);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login attempts
    await this.prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    // Handle MFA
    if (user.mfaEnabled) {
      if (!dto.mfaCode) {
        // Issue temporary MFA token
        const mfaToken = uuidv4();
        await this.redis.set(`mfa:pending:${mfaToken}`, { userId: user.id, tenantId }, MFA_TOKEN_TTL);
        return {
          tokens: { accessToken: '', refreshToken: '', tokenType: 'Bearer', expiresIn: 0 },
          user: this.mapUserToAuthUser(user, [], []),
          requiresMfa: true,
          mfaToken,
        };
      }

      const isValidMfa = await this.verifyTotpCode(user.id, dto.mfaCode, tenantId);
      if (!isValidMfa) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    const roles = user.userRoles.map((ur) => ur.role.slug);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
        ),
      ),
    ];

    const tokens = await this.issueTokenPair(user.id, tenantId, user.email, user.userType, roles, permissions);

    // Store refresh token
    await this.storeRefreshToken(user.id, tenantId, tokens.refreshToken, ipAddress, userAgent, uuidv4());

    this.eventEmitter.emit('auth.login', {
      userId: user.id,
      tenantId,
      email: user.email,
      ipAddress,
      userAgent,
    });

    return {
      tokens,
      user: this.mapUserToAuthUser(user, roles, permissions),
      requiresMfa: false,
    };
  }

  // ─── MFA Verify (after login) ─────────────────────────────────────────────

  async verifyMfaAndLogin(dto: VerifyMfaDto, ipAddress?: string, userAgent?: string): Promise<LoginResponse> {
    const pending = await this.redis.get<{ userId: string; tenantId: string }>(`mfa:pending:${dto.mfaToken}`);
    if (!pending) throw new UnauthorizedException('MFA token expired or invalid');

    const isValid = await this.verifyTotpCode(pending.userId, dto.code, pending.tenantId);
    if (!isValid) throw new UnauthorizedException('Invalid MFA code');

    await this.redis.del(`mfa:pending:${dto.mfaToken}`);

    const user = await this.prisma.user.findFirst({
      where: { id: pending.userId, tenantId: pending.tenantId },
      include: {
        userRoles: {
          where: { isActive: true },
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const roles = user.userRoles.map((ur) => ur.role.slug);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
        ),
      ),
    ];

    const family = uuidv4();
    const tokens = await this.issueTokenPair(user.id, pending.tenantId, user.email, user.userType, roles, permissions);
    await this.storeRefreshToken(user.id, pending.tenantId, tokens.refreshToken, ipAddress, userAgent, family);

    return {
      tokens,
      user: this.mapUserToAuthUser(user, roles, permissions),
      requiresMfa: false,
    };
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  async register(dto: RegisterDto, tenantId: string): Promise<RegisterResponse> {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, tenantId },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Check tenant user limit
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const userCount = await this.prisma.user.count({
      where: { tenantId, status: { not: 'INACTIVE' }, deletedAt: null },
    });

    if (userCount >= tenant.maxUsers) {
      throw new ForbiddenException(`User limit reached (${tenant.maxUsers}). Upgrade your plan.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let cognitoSub: string | undefined;

    // Register in Cognito if configured (tenant has own user pool)
    if (this.useCognito && tenant.cognitoUserPoolId && tenant.cognitoClientId) {
      cognitoSub = await this.registerWithCognito(
        dto.email,
        dto.password,
        tenant.cognitoUserPoolId,
        tenant.cognitoClientId,
        tenant.cognitoClientSecret ?? undefined,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        userType: dto.userType ?? 'EMPLOYEE',
        employeeId: dto.employeeId,
        status: 'PENDING_VERIFICATION',
        cognitoSub,
        passwordHash,
      },
    });

    // Assign default role
    await this.assignDefaultRole(user.id, tenantId);

    this.eventEmitter.emit('auth.register', {
      userId: user.id,
      tenantId,
      email: user.email,
    });

    return {
      message: 'Registration successful. Please verify your email to activate your account.',
      userId: user.id,
      requiresEmailVerification: true,
    };
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────

  async refreshToken(dto: RefreshTokenDto, ipAddress?: string): Promise<RefreshTokenResponse> {
    const tokenHash = this.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, isRevoked: false },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true, revokedReason: 'expired' },
      });
      throw new UnauthorizedException('Refresh token has expired. Please log in again.');
    }

    // Detect token reuse (security: revoke entire family)
    const familyTokens = await this.prisma.refreshToken.findMany({
      where: { family: storedToken.family, isRevoked: true },
    });

    if (familyTokens.length > 0) {
      // Token family was already revoked — potential theft
      await this.prisma.refreshToken.updateMany({
        where: { family: storedToken.family },
        data: { isRevoked: true, revokedReason: 'potential_theft', revokedAt: new Date() },
      });

      // Invalidate all sessions for this user
      await this.redis.del(`user:auth:${storedToken.userId}`);

      this.logger.warn(`Refresh token reuse detected for user ${storedToken.userId}`);
      throw new UnauthorizedException(
        'Security alert: token reuse detected. All sessions have been revoked. Please log in again.',
      );
    }

    // Revoke used token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true, revokedAt: new Date(), revokedReason: 'rotated' },
    });

    const user = storedToken.user;
    const userRoles = await this.getUserRolesAndPermissions(user.id, storedToken.tenantId);

    const tokens = await this.issueTokenPair(
      user.id,
      storedToken.tenantId,
      user.email,
      user.userType,
      userRoles.roles,
      userRoles.permissions,
    );

    await this.storeRefreshToken(
      user.id,
      storedToken.tenantId,
      tokens.refreshToken,
      ipAddress,
      undefined,
      storedToken.family,
    );

    return { tokens };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(userId: string, accessToken: string, refreshToken?: string): Promise<MessageResponse> {
    // Blacklist access token
    try {
      const decoded = this.jwtService.decode(accessToken) as JwtPayload;
      if (decoded?.iat) {
        const ttl = (decoded.exp || 0) - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await this.redis.set(`blacklist:${userId}:${decoded.iat}`, '1', ttl);
        }
      }
    } catch {
      // Ignore decode errors
    }

    // Revoke refresh token if provided
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date(), revokedReason: 'logout' },
      });
    }

    // Clear user cache
    await this.redis.del(`user:auth:${userId}`);

    this.eventEmitter.emit('auth.logout', { userId });

    return { message: 'Logged out successfully', success: true };
  }

  // ─── MFA Setup ────────────────────────────────────────────────────────────

  async setupMfa(userId: string, tenantId: string): Promise<MfaSetupResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.mfaEnabled) throw new ConflictException('MFA is already enabled');

    const secret = authenticator.generateSecret(32);
    const appName = this.config.get<string>('mfa.appName', 'AMS');
    const otpauthUrl = authenticator.keyuri(user.email, appName, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Generate backup codes
    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );
    const backupCodeHashes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(code, BCRYPT_ROUNDS)),
    );

    // Store secret temporarily until confirmed
    await this.redis.set(`mfa:setup:${userId}`, { secret, backupCodeHashes }, 600);

    return {
      secret,
      qrCodeUrl,
      backupCodes: backupCodes.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`),
    };
  }

  async confirmMfaSetup(userId: string, tenantId: string, code: string): Promise<MessageResponse> {
    const setupData = await this.redis.get<{ secret: string; backupCodeHashes: string[] }>(
      `mfa:setup:${userId}`,
    );
    if (!setupData) throw new BadRequestException('MFA setup expired. Please start over.');

    const isValid = authenticator.verify({ token: code, secret: setupData.secret });
    if (!isValid) throw new BadRequestException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaSecret: this.encryptSecret(setupData.secret),
        mfaBackupCodes: setupData.backupCodeHashes,
      },
    });

    await this.redis.del(`mfa:setup:${userId}`);
    await this.redis.del(`user:auth:${userId}`);

    this.eventEmitter.emit('auth.mfa.enabled', { userId, tenantId });

    return { message: 'MFA enabled successfully', success: true };
  }

  // ─── Password Management ──────────────────────────────────────────────────

  async changePassword(userId: string, tenantId: string, dto: ChangePasswordDto): Promise<MessageResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('User not found');

    const isValid = await this.verifyPassword(dto.currentPassword, user, tenantId);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
      },
    });

    // Revoke all refresh tokens (force re-login everywhere)
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedReason: 'password_changed', revokedAt: new Date() },
    });

    await this.redis.del(`user:auth:${userId}`);

    this.eventEmitter.emit('auth.password.changed', { userId, tenantId });

    return { message: 'Password changed successfully. Please log in again.', success: true };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async issueTokenPair(
    userId: string,
    tenantId: string,
    email: string,
    userType: string,
    roles: string[],
    permissions: string[],
  ) {
    const sessionId = uuidv4();
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn', '15m');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn', '7d');

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      email,
      userType,
      roles,
      permissions,
      type: 'access',
      sessionId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiresIn,
      secret: this.config.get<string>('jwt.accessSecret'),
      issuer: this.config.get<string>('jwt.issuer'),
      audience: this.config.get<string>('jwt.audience'),
    });

    const refreshToken = this.jwtService.sign(
      { sub: userId, tenantId, type: 'refresh', sessionId },
      {
        expiresIn: refreshExpiresIn,
        secret: this.config.get<string>('jwt.refreshSecret'),
        issuer: this.config.get<string>('jwt.issuer'),
        audience: this.config.get<string>('jwt.audience'),
      },
    );

    const accessExpiresInSeconds = this.parseExpiresIn(accessExpiresIn);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresInSeconds,
    };
  }

  private async storeRefreshToken(
    userId: string,
    tenantId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string,
    family?: string,
  ) {
    const tokenHash = this.hashToken(token);
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn', '7d');
    const expiresAt = new Date(Date.now() + this.parseExpiresIn(refreshExpiresIn) * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tenantId,
        tokenHash,
        family: family || uuidv4(),
        ipAddress,
        userAgent,
        expiresAt,
      },
    });
  }

  private async verifyPassword(password: string, user: { passwordHash: string | null; cognitoSub?: string | null }, _tenantId: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  private async verifyTotpCode(userId: string, code: string, tenantId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { mfaSecret: true, mfaBackupCodes: true },
    });

    if (!user?.mfaSecret) return false;

    const secret = this.decryptSecret(user.mfaSecret);

// Check TOTP
const isValidTotp = authenticator.verify({
  token: code,
  secret,
});
    if (isValidTotp) return true;

    // Check backup codes
    const normalizedCode = code.replace('-', '').toUpperCase();
    for (let i = 0; i < user.mfaBackupCodes.length; i++) {
      const isMatch = await bcrypt.compare(normalizedCode, user.mfaBackupCodes[i]);
      if (isMatch) {
        // Remove used backup code
        const newCodes = [...user.mfaBackupCodes];
        newCodes.splice(i, 1);
        await this.prisma.user.update({
          where: { id: userId },
          data: { mfaBackupCodes: newCodes },
        });
        return true;
      }
    }

    return false;
  }

  private async handleFailedLogin(userId: string, _tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) return;

    const attempts = user.loginAttempts + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: { loginAttempts: attempts, lockedUntil: lockUntil },
    });
  }

  private async recordFailedLogin(email: string, tenantId: string) {
    const key = `failed_login:${tenantId}:${email}`;
    await this.redis.incr(key);
    await this.redis.expire(key, 900);
  }

  private async assignDefaultRole(userId: string, tenantId: string) {
    const defaultRole = await this.prisma.role.findFirst({
      where: { OR: [{ tenantId, isDefault: true }, { isSystem: true, slug: 'employee', tenantId: null }] },
    });

    if (defaultRole) {
      await this.prisma.userRole.create({
        data: { userId, roleId: defaultRole.id, tenantId },
      });
    }
  }

  private async getUserRolesAndPermissions(userId: string, tenantId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, tenantId, isActive: true },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });

    const roles = userRoles.map((ur) => ur.role.slug);
    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
        ),
      ),
    ];

    return { roles, permissions };
  }

  private async registerWithCognito(
    email: string,
    password: string,
    userPoolId: string,
    clientId: string,
    clientSecret?: string,
  ): Promise<string> {
    if (!this.cognitoClient) throw new Error('Cognito not configured');

    const result = await this.cognitoClient.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        SecretHash: clientSecret
          ? this.computeCognitoSecretHash(email, clientId, clientSecret)
          : undefined,
      }),
    );

    return result.UserSub || '';
  }

  private computeCognitoSecretHash(username: string, clientId: string, clientSecret: string): string {
    return crypto
      .createHmac('SHA256', clientSecret)
      .update(username + clientId)
      .digest('base64');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private encryptSecret(secret: string): string {
    const key = Buffer.from(this.config.get<string>('encryption.key', '').padEnd(32).slice(0, 32));
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptSecret(encrypted: string): string {
    const [ivHex, dataHex] = encrypted.split(':');
    const key = Buffer.from(this.config.get<string>('encryption.key', '').padEnd(32).slice(0, 32));
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString();
  }

  private mapUserToAuthUser(user: {
    id: string;
    tenantId: string;
    email: string;
    firstName: string;
    lastName: string;
    userType: string;
    status: string;
    mfaEnabled: boolean;
    avatar?: string | null;
  }, roles: string[], permissions: string[]) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      status: user.status,
      roles,
      permissions,
      mfaEnabled: user.mfaEnabled,
      avatar: user.avatar ?? undefined,
    };
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const [, num, unit] = match;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(num) * (multipliers[unit] || 60);
  }
}
