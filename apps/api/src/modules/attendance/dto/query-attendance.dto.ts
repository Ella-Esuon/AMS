import { IsOptional, IsEnum, IsUUID, IsISO8601, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { AttendanceStatus } from '@prisma/client';
import { PaginationArgs } from '../../../common/types/pagination.types';

@InputType()
export class QueryAttendanceDto extends PaginationArgs {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by department ID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Filter by location ID' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @Field(() => AttendanceStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

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

  @ApiPropertyOptional({ description: 'Filter late arrivals only' })
  @Field({ nullable: true })
  @IsOptional()
  isLate?: boolean;

  @ApiPropertyOptional({ description: 'Filter manual entries only' })
  @Field({ nullable: true })
  @IsOptional()
  isManualEntry?: boolean;
}
