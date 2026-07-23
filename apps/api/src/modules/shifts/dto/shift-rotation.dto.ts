import {
  IsString,
  IsOptional,
  IsInt,
  IsISO8601,
  IsUUID,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';

@InputType()
export class RotationSlotDto {
  @ApiProperty({ description: 'Day index within the cycle (0 = first day, cycleDays-1 = last day)' })
  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Type(() => Number)
  dayOffset: number;

@ApiPropertyOptional({ description: 'Shift ID for this slot. Null = day off.' })
@Field(() => String, { nullable: true })
@IsOptional()
@IsUUID()
shiftId?: string | null;
}

@InputType()
export class CreateRotationDto {
  @ApiProperty({ example: '2-Week Day/Night Rotation' })
  @Field()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Number of days in one full rotation cycle', example: 14 })
  @Field(() => Int)
  @IsInt()
  @Min(2)
  @Max(365)
  @Type(() => Number)
  cycleDays: number;

  @ApiProperty({
    description: 'Reference epoch date for cycle calculation (YYYY-MM-DD). Day 0 of the cycle.',
    example: '2025-01-06',
  })
  @Field()
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({
    type: [RotationSlotDto],
    description: 'Slot definitions. Can be provided on creation or added later via the slots endpoint.',
  })
  @Field(() => [RotationSlotDto], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RotationSlotDto)
  slots?: RotationSlotDto[];
}

@InputType()
export class UpsertRotationSlotDto {
  @ApiProperty({ description: 'Day offset within the cycle (0-based)' })
  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Type(() => Number)
  dayOffset: number;

  @ApiPropertyOptional({ description: 'Shift ID for this slot. Null = day off.' })
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  shiftId?: string | null;
}
