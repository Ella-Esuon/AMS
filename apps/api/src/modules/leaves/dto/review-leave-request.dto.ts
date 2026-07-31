import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { LeaveRequestStatus } from '@prisma/client';

@InputType()
export class ReviewLeaveRequestDto {
  @ApiProperty({
    enum: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED],
    description: 'Review decision',
  })
  @Field(() => LeaveRequestStatus)
  @IsIn([LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED])
  decision: typeof LeaveRequestStatus.APPROVED | typeof LeaveRequestStatus.REJECTED;

  @ApiPropertyOptional({ description: 'Required when decision is REJECTED' })
  @Field({ nullable: true })
  @ValidateIf((o) => o.decision === LeaveRequestStatus.REJECTED)
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
