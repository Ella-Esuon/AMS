import { IsOptional, IsEnum, IsUUID, IsString, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { LeaveRequestStatus } from '@prisma/client';
import { PaginationArgs } from '../../../common/types/pagination.types';

@InputType()
export class QueryLeaveRequestDto extends PaginationArgs {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by leave type' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @ApiPropertyOptional({ enum: LeaveRequestStatus })
  @Field(() => LeaveRequestStatus, { nullable: true })
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601 date string, e.g. 2025-01-01)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601 date string, e.g. 2025-01-31)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  endDate?: string;
}

@InputType()
export class QueryLeaveBalanceDto {
  @ApiPropertyOptional({ description: 'Year to fetch balances for. Defaults to the current year.' })
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year?: number;
}
