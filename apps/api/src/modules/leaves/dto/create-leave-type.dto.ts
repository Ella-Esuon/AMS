import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Matches,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';

const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

@InputType()
export class CreateLeaveTypeDto {
  @ApiProperty({ example: 'Annual Leave' })
  @Field()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'ANNUAL' })
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

  @ApiPropertyOptional({ default: true, description: 'Whether time off under this type is paid' })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description: 'Default annual entitlement in days. 0 = unlimited / not balance-tracked',
  })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  defaultDaysPerYear?: number;

  @ApiPropertyOptional({ default: true })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(COLOR_REGEX, { message: 'colorCode must be a hex color (e.g. #3B82F6)' })
  colorCode?: string;
}
