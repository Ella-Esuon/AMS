import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../database/redis.service';
import { JwtPayload, AuthenticatedUser } from '../../../common/types/request.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
      issuer: config.get<string>('jwt.issuer'),
      audience: config.get<string>('jwt.audience'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Check if token is blacklisted (logged out / revoked)
    const isBlacklisted = await this.redis.exists(`blacklist:${payload.sub}:${payload.iat}`);
    if (isBlacklisted) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Fetch user from cache or database
    const cacheKey = `user:auth:${payload.sub}`;
    const cachedUser = await this.redis.get<AuthenticatedUser>(cacheKey);
    if (cachedUser) return cachedUser;

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        userType: true,
        status: true,
        mfaEnabled: true,
        avatar: true,
        cognitoSub: true,
        userRoles: {
          where: { isActive: true },
          include: {
            role: {
              include: {
                rolePermissions: {
                  where: {},
                  include: {
                    permission: { select: { resource: true, action: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (user.status === 'SUSPENDED' || user.status === 'LOCKED') {
      throw new UnauthorizedException(`Account is ${user.status.toLowerCase()}`);
    }

    if (user.status === 'INACTIVE') {
      throw new UnauthorizedException('Account is inactive');
    }

    const roles = user.userRoles.map((ur) => ur.role.slug);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
        ),
      ),
    ];

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      roles,
      permissions,
      cognitoSub: user.cognitoSub,
      mfaEnabled: user.mfaEnabled,
      sessionId: payload.sessionId,
    };

    // Cache for 5 minutes
    await this.redis.set(cacheKey, authenticatedUser, 300);

    return authenticatedUser;
  }
}
