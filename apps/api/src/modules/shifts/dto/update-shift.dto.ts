import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  Matches,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

@InputType()
export class UpdateShiftDto {
  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm (e.g. 09:00)' })
  startTime?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm (e.g. 17:00)' })
  endTime?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isNightShift?: boolean;

  @ApiPropertyOptional({ type: [Number] })
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

  @ApiPropertyOptional()
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  @Type(() => Number)
  graceMinutes?: number;

  @ApiPropertyOptional({ nullable: true })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(720)
  @Type(() => Number)
  overtimeAfterMinutes?: number | null;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, { message: 'colorCode must be a hex color (e.g. #3B82F6)' })
  colorCode?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
