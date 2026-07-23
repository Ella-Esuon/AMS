import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  MinLength,
  MaxLength,
  Matches,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { UserType } from '@prisma/client';

@InputType()
export class CreateUserDto {
  @ApiProperty({ example: 'John' })
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (value as string).trim())
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (value as string).trim())
  lastName: string;

  @ApiProperty({ example: 'john.doe@company.com' })
  @Field()
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @ApiPropertyOptional({ description: 'Temporary password (auto-generated if not provided)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password does not meet complexity requirements',
  })
  password?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ enum: UserType, default: UserType.EMPLOYEE })
  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional({ example: 'EMP-001' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Department UUID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Manager user UUID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Location UUID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: '2024-01-15', description: 'Employment start date' })
  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @ApiPropertyOptional({ description: 'Role IDs to assign' })
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ default: true, description: 'Send welcome email with credentials' })
  @Field({ nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  sendWelcomeEmail?: boolean;
}

@InputType()
export class InviteUserDto {
  @ApiProperty()
  @Field()
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @ApiProperty()
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ enum: UserType })
  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}
