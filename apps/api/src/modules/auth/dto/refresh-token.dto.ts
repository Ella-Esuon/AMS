import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class RefreshTokenDto {
  @ApiProperty({ description: 'Valid refresh token' })
  @Field()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

@InputType()
export class VerifyMfaDto {
  @ApiProperty({ description: '6-digit TOTP code or 8-character backup code' })
  @Field()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Temporary MFA token received after login' })
  @Field()
  @IsString()
  @IsNotEmpty()
  mfaToken: string;
}

@InputType()
export class DisableMfaDto {
  @ApiProperty({ description: '6-digit TOTP code to confirm MFA disable' })
  @Field()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @Field()
  @IsString()
  @IsNotEmpty()
  password: string;
}
