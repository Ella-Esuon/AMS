import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { UserType } from '@prisma/client';

@InputType()
export class RegisterDto {
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

  @ApiProperty({
    example: 'SecurePass123!',
    description: 'Min 8 chars, at least 1 uppercase, 1 lowercase, 1 number, 1 special char',
  })
  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password must contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character (@$!%*?&)',
  })
  password: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ enum: UserType, default: UserType.EMPLOYEE })
  @Field({ nullable: true, defaultValue: UserType.EMPLOYEE })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional({ example: 'EMP-001' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeId?: string;
}

@InputType()
export class ChangePasswordDto {
  @ApiProperty()
  @Field()
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty()
  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password does not meet complexity requirements',
  })
  newPassword: string;
}

@InputType()
export class ForgotPasswordDto {
  @ApiProperty({ example: 'john.doe@company.com' })
  @Field()
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;
}

@InputType()
export class ResetPasswordDto {
  @ApiProperty()
  @Field()
  @IsString()
  token: string;

  @ApiProperty()
  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'Password does not meet complexity requirements',
  })
  newPassword: string;
}
