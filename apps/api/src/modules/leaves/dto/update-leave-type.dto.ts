import { IsString, IsOptional, IsBoolean, IsInt, Matches, Min, Max, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';

const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

@InputType()
export class UpdateLeaveTypeDto {
  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
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
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional()
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  defaultDaysPerYear?: number;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

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
