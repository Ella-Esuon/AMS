import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsISO8601,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class AssignShiftDto {
  @ApiProperty({ description: 'User to assign the shift to' })
  @Field()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({
    description: 'Fixed shift ID. Required if rotationId is not provided.',
  })
  @Field(() => String, { nullable: true })
  @ValidateIf((o) => !o.rotationId)
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional({
    description: 'Rotation ID. Required if shiftId is not provided.',
  })
  @Field(() => String, { nullable: true })
  @ValidateIf((o) => !o.shiftId)
  @IsUUID()
  rotationId?: string;

  @ApiProperty({ description: 'First day this assignment is effective (YYYY-MM-DD)' })
  @Field(() => String)
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({
    description: 'Last day this assignment is effective (YYYY-MM-DD). Omit for open-ended.',
  })
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @ApiPropertyOptional()

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class UpdateAssignmentDto {
  @ApiPropertyOptional()
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional()
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  rotationId?: string;

  @ApiPropertyOptional()
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @ApiPropertyOptional()
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
