import { IsUUID, IsInt, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';

@InputType()
export class AdjustLeaveBalanceDto {
  @ApiProperty({ description: 'User whose balance is being adjusted' })
  @Field()
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Leave type this balance applies to' })
  @Field()
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ description: 'Year this balance applies to' })
  @Field(() => Int)
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year: number;

  @ApiPropertyOptional({ description: 'Total allocated days for the year (absolute value, not a delta)' })
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  allocatedDays?: number;

  @ApiPropertyOptional({ description: 'Days carried over from the previous year (absolute value, not a delta)' })
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  carriedOverDays?: number;
}
