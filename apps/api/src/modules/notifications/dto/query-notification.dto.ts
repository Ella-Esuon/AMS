import { IsOptional, IsEnum, IsBoolean, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { NotificationCategory, NotificationPriority } from '@prisma/client';
import { PaginationArgs } from '../../../common/types/pagination.types';

@InputType()
export class QueryNotificationDto extends PaginationArgs {
  @ApiPropertyOptional({ enum: NotificationCategory })
  @Field(() => NotificationCategory, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationPriority })
  @Field(() => NotificationPriority, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({ description: 'Filter by read/unread status' })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({ description: "Filter by linked resource type, e.g. 'leave_request'" })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601), filters by createdAt' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601), filters by createdAt' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  endDate?: string;
}
