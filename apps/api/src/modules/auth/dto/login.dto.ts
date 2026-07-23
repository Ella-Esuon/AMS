import { IsEmail, IsString, MinLength, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { Transform } from 'class-transformer';

@InputType()
export class LoginDto {
  @ApiProperty({ example: 'admin@company.com' })
  @Field()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @Field()
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password: string;

  @ApiPropertyOptional({ description: 'MFA TOTP code (6 digits)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  mfaCode?: string;

  @ApiPropertyOptional({ description: 'Remember this device for 30 days' })
  @Field({ nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
