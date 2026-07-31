import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { PaginationArgs } from '../../../common/types/pagination.types';

@InputType()
export class QueryLeaveTypeDto extends PaginationArgs {
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
