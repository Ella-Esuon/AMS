import {
  IsOptional,
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  IsISO8601,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { InputType, Field, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ClockMethod, AttendanceStatus } from '@prisma/client';

@InputType()
export class ClockOutDto {
  @ApiPropertyOptional({ enum: ClockMethod, default: ClockMethod.MANUAL })
  @Field(() => ClockMethod, { nullable: true })
  @IsOptional()
  @IsEnum(ClockMethod)
  method?: ClockMethod;

  @ApiPropertyOptional({ description: 'GPS latitude (-90 to 90)' })
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ description: 'GPS longitude (-180 to 180)' })
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Device identifier' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Optional notes for this clock-out' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class EndBreakDto {
  @ApiPropertyOptional({ description: 'Optional notes about the break' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class UpdateAttendanceDto {
  @ApiPropertyOptional({ description: 'Override clock-in time (ISO 8601)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsISO8601()
  clockIn?: string;

  @ApiPropertyOptional({ description: 'Override clock-out time (ISO 8601)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsISO8601()
  clockOut?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @Field(() => AttendanceStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class ManualEntryDto {
  @ApiProperty({ description: 'User ID for the manual entry' })
  @Field()
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Date in YYYY-MM-DD format' })
  @Field()
  @IsISO8601()
  date: string;

  @ApiPropertyOptional({ description: 'Clock-in time (ISO 8601)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsISO8601()
  clockIn?: string;

  @ApiPropertyOptional({ description: 'Clock-out time (ISO 8601)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsISO8601()
  clockOut?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @Field(() => AttendanceStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
