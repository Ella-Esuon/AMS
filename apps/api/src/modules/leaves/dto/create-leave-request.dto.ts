import { IsString, IsOptional, IsBoolean, IsUUID, IsISO8601, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateLeaveRequestDto {
  @ApiProperty({ description: 'Leave type to request' })
  @Field()
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ description: 'First day of leave (YYYY-MM-DD)' })
  @Field()
  @IsISO8601()
  startDate: string;

  @ApiProperty({ description: 'Last day of leave (YYYY-MM-DD), inclusive' })
  @Field()
  @IsISO8601()
  endDate: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Half-day leave. Only valid when startDate equals endDate.',
  })
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
