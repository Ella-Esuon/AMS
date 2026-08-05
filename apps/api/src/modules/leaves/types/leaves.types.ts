import { ObjectType, Field, Int, Float, ID, registerEnumType } from '@nestjs/graphql';
import { LeaveRequestStatus } from '@prisma/client';
import { createPaginatedType } from '../../../common/types/pagination.types';

registerEnumType(LeaveRequestStatus, {
  name: 'LeaveRequestStatus',
  description: 'Status of a leave request',
});

@ObjectType()
export class LeaveTypeType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  code?: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  isPaid: boolean;

  @Field(() => Int)
  defaultDaysPerYear: number;

  @Field()
  requiresApproval: boolean;

  @Field({ nullable: true })
  colorCode?: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class LeaveBalanceType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  userId: string;

  @Field()
  leaveTypeId: string;

  @Field(() => Int)
  year: number;

  @Field(() => Float)
  allocatedDays: number;

  @Field(() => Float)
  usedDays: number;

  @Field(() => Float)
  carriedOverDays: number;

  @Field(() => Float)
  availableDays: number;
}

@ObjectType()
export class LeaveRequestType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  userId: string;

  @Field()
  leaveTypeId: string;

  @Field()
  startDate: Date;

  @Field()
  endDate: Date;

  @Field()
  isHalfDay: boolean;

  @Field(() => Float)
  totalDays: number;

  @Field({ nullable: true })
  reason?: string;

  @Field(() => LeaveRequestStatus)
  status: LeaveRequestStatus;

  @Field({ nullable: true })
  reviewedBy?: string;

  @Field({ nullable: true })
  reviewedAt?: Date;

  @Field({ nullable: true })
  rejectionReason?: string;

  @Field({ nullable: true })
  cancelledAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class PaginatedLeaveTypeType extends createPaginatedType(LeaveTypeType) {}

@ObjectType()
export class PaginatedLeaveRequestType extends createPaginatedType(LeaveRequestType) {}
