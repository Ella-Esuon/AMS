import { IsUUID, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { NotificationCategory, NotificationPriority } from '@prisma/client';

@InputType()
export class CreateNotificationDto {
  @ApiProperty({ description: 'User to notify (must belong to the caller\'s tenant)' })
  @Field()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ enum: NotificationCategory, default: NotificationCategory.SYSTEM })
  @Field(() => NotificationCategory, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationPriority, default: NotificationPriority.NORMAL })
  @Field(() => NotificationPriority, { nullable: true })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiProperty({ example: 'Policy update' })
  @Field()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Please review the updated attendance policy.' })
  @Field()
  @IsString()
  @MaxLength(2000)
  message: string;
}
