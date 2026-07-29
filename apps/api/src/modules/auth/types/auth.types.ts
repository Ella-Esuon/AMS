import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class TokenPair {
  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;

  @Field()
  tokenType: string;

  @Field()
  expiresIn: number;
}

@ObjectType()
export class AuthUser {
  @Field()
  id: string;

  @Field()
  tenantId: string;

  @Field()
  email: string;

  @Field()
  firstName: string;

  @Field()
  lastName: string;

  @Field()
  userType: string;

  @Field()
  status: string;

  @Field(() => [String])
  roles: string[];

  @Field(() => [String])
  permissions: string[];

  @Field()
  mfaEnabled: boolean;

  @Field({ nullable: true })
  avatar?: string;
}

@ObjectType()
export class LoginResponse {
  @Field(() => TokenPair)
  tokens: TokenPair;

  @Field(() => AuthUser)
  user: AuthUser;

  @Field()
  requiresMfa: boolean;

  @Field({ nullable: true })
  mfaToken?: string;
}

@ObjectType()
export class RegisterResponse {
  @Field()
  message: string;

  @Field()
  userId: string;

  @Field()
  requiresEmailVerification: boolean;
}

@ObjectType()
export class MfaSetupResponse {
  @Field()
  secret: string;

  @Field()
  qrCodeUrl: string;

  @Field(() => [String])
  backupCodes: string[];
}

@ObjectType()
export class RefreshTokenResponse {
  @Field(() => TokenPair)
  tokens: TokenPair;
}

@ObjectType()
export class MessageResponse {
  @Field()
  message: string;

  @Field()
  success: boolean;
}
