import {
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ClockMethod } from '@prisma/client';

@InputType()
export class AttendancePolicyDto {
  @ApiPropertyOptional({ description: 'Late-arrival grace period in minutes', default: 15 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  @Type(() => Number)
  graceMinutes?: number;

  @ApiPropertyOptional({ description: 'Auto clock-out after N minutes past shift end. Null = disabled' })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  @Type(() => Number)
  autoClockOutMinutes?: number | null;

  @ApiPropertyOptional({ description: 'Maximum allowed work hours per day', default: 12 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  @Type(() => Number)
  maxWorkHours?: number;

  @ApiPropertyOptional({ description: 'Minimum break duration in minutes', default: 0 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  @Type(() => Number)
  minBreakMinutes?: number;

  @ApiPropertyOptional({ description: 'Maximum break duration in minutes before flagging', default: 60 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  @Type(() => Number)
  maxBreakMinutes?: number;

  @ApiPropertyOptional({ description: 'Work minutes threshold before overtime starts', default: 480 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(720)
  @Type(() => Number)
  overtimeAfterMinutes?: number;

  @ApiPropertyOptional({ description: 'Whether GPS location is required for clock-in/out', default: false })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  requireGpsLocation?: boolean;

  @ApiPropertyOptional({ description: 'Allowed distance from work location in meters', default: 100 })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  @Type(() => Number)
  gpsRadiusMeters?: number;

  @ApiPropertyOptional({ description: 'Allow clock-in via mobile app', default: true })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  allowMobileClockIn?: boolean;

  @ApiPropertyOptional({
    enum: ClockMethod,
    isArray: true,
    description: 'Allowed clock-in methods',
  })
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClockMethod, { each: true })
  allowedMethods?: string[];

  @ApiPropertyOptional({ default: true })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
