import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsEnum,
  Matches,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { BreakType } from '@prisma/client';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

@InputType()
export class CreateShiftDto {
  @ApiProperty({ example: 'Morning Shift' })
  @Field()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'MORN' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '09:00', description: 'Shift start time in HH:mm (24-hour)' })
  @Field()
  @IsString()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm (e.g. 09:00)' })
  startTime: string;

  @ApiProperty({ example: '17:00', description: 'Shift end time in HH:mm (24-hour)' })
  @Field()
  @IsString()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm (e.g. 17:00)' })
  endTime: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Set true when endTime is on the next calendar day (night shifts)',
  })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isNightShift?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    default: [1, 2, 3, 4, 5],
    description: 'ISO weekdays shift runs on: 1=Mon, 2=Tue … 7=Sun',
  })
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  @Type(() => Number)
  workDays?: number[];

  @ApiPropertyOptional({
    default: 0,
    description: 'Minutes of grace for late arrival. 0 = inherit from AttendancePolicy',
  })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  @Type(() => Number)
  graceMinutes?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Work minutes before overtime kicks in. null = inherit from AttendancePolicy',
  })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(720)
  @Type(() => Number)
  overtimeAfterMinutes?: number | null;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, { message: 'colorCode must be a hex color (e.g. #3B82F6)' })
  colorCode?: string;
}

@InputType()
export class CreateBreakRuleDto {
  @ApiProperty({ example: 'Lunch Break' })
  @Field()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ enum: BreakType, default: BreakType.SHORT_BREAK })
  @Field(() => BreakType, { nullable: true })
  @IsOptional()
  @IsEnum(BreakType)
  breakType?: BreakType;

  @ApiProperty({ description: 'Minutes after shift start when break begins', example: 240 })
  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Type(() => Number)
  startOffsetMins: number;

  @ApiProperty({ description: 'Duration of the break in minutes', example: 30 })
  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(480)
  @Type(() => Number)
  durationMinutes: number;

  @ApiPropertyOptional({ default: false })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ default: true })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
