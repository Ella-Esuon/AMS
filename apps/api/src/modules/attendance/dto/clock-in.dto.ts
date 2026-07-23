import {
  IsOptional,
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ClockMethod, BreakType } from '@prisma/client';

@InputType()
export class ClockInDto {
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

  @ApiPropertyOptional({ description: 'Location ID for geo-fencing validation' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Device identifier (phone ID, terminal ID, etc.)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Optional notes for this clock-in' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class StartBreakDto {
  @ApiPropertyOptional({ enum: BreakType, default: BreakType.SHORT_BREAK })
  @Field(() => BreakType, { nullable: true })
  @IsOptional()
  @IsEnum(BreakType)
  breakType?: BreakType;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
