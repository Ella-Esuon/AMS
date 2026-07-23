import { IsOptional, IsBoolean, IsUUID, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { PaginationArgs } from '../../../common/types/pagination.types';

@InputType()
export class QueryShiftDto extends PaginationArgs {
  @ApiPropertyOptional({ description: 'Filter by active status' })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Search by name or code' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  declare search?: string;
}

@InputType()
export class QueryAssignmentDto extends PaginationArgs {
  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filter by date (YYYY-MM-DD) to see who is assigned on that day' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  date?: string;
}
