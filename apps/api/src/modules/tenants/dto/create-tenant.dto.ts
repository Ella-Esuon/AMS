import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsInt,
  MinLength,
  MaxLength,
  Min,
  Max,
  Matches,
  IsUrl,
  IsHexColor,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { PlanType } from '@prisma/client';

@InputType()
export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(({ value }) => (value as string).trim())
  name: string;

  @ApiPropertyOptional({ example: 'acme-corp', description: 'Auto-generated if not provided' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  slug?: string;

  @ApiPropertyOptional({ example: 'attendance.acme.com' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @ApiProperty({ example: 'admin@acme.com' })
  @Field()
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  contactEmail: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional({ enum: PlanType, default: PlanType.FREE })
  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(PlanType)
  plan?: PlanType;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 10000 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxUsers?: number;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ example: 'en-US' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @Field({ nullable: true })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;
}

@InputType()
export class RegisterTenantDto extends CreateTenantDto {
  @ApiProperty({ description: 'Admin first name' })
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  adminFirstName: string;

  @ApiProperty({ description: 'Admin last name' })
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  adminLastName: string;

  @ApiProperty({ description: 'Admin password' })
  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password does not meet complexity requirements',
  })
  adminPassword: string;
}
