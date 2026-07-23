import { ObjectType, Field, Int, Float, ID, registerEnumType } from '@nestjs/graphql';
import { AttendanceStatus, ClockMethod, BreakType } from '@prisma/client';
import { createPaginatedType } from '../../../common/types/pagination.types';

registerEnumType(AttendanceStatus, {
  name: 'AttendanceStatus',
  description: 'Attendance record status',
});

registerEnumType(ClockMethod, {
  name: 'ClockMethod',
  description: 'Method used to clock in or out',
});

registerEnumType(BreakType, {
  name: 'BreakType',
  description: 'Type of break taken during the shift',
});

@ObjectType()
export class AttendanceBreakType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  attendanceId: string;

  @Field(() => BreakType)
  breakType: BreakType;

  @Field()
  startTime: Date;

  @Field({ nullable: true })
  endTime?: Date;

  @Field(() => Int, { nullable: true })
  durationMinutes?: number;

  @Field({ nullable: true })
  notes?: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class AttendanceRecordType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  shiftId?: string;

  @Field({ nullable: true })
  locationId?: string;

  @Field()
  date: Date;

  @Field({ nullable: true })
  scheduledIn?: Date;

  @Field({ nullable: true })
  scheduledOut?: Date;

  @Field({ nullable: true })
  clockIn?: Date;

  @Field({ nullable: true })
  clockOut?: Date;

  @Field(() => ClockMethod, { nullable: true })
  clockInMethod?: ClockMethod;

  @Field(() => ClockMethod, { nullable: true })
  clockOutMethod?: ClockMethod;

  @Field(() => Float, { nullable: true })
  clockInLat?: number;

  @Field(() => Float, { nullable: true })
  clockInLng?: number;

  @Field(() => Float, { nullable: true })
  clockOutLat?: number;

  @Field(() => Float, { nullable: true })
  clockOutLng?: number;

  @Field({ nullable: true })
  clockInDevice?: string;

  @Field({ nullable: true })
  clockOutDevice?: string;

  @Field(() => AttendanceStatus)
  status: AttendanceStatus;

  @Field(() => Int, { nullable: true })
  workMinutes?: number;

  @Field(() => Int, { nullable: true })
  overtimeMinutes?: number;

  @Field(() => Int)
  breakMinutes: number;

  @Field()
  isLate: boolean;

  @Field(() => Int)
  lateMinutes: number;

  @Field()
  isEarlyDeparture: boolean;

  @Field(() => Int)
  earlyMinutes: number;

  @Field()
  isManualEntry: boolean;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  approvalStatus?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => [AttendanceBreakType])
  breaks: AttendanceBreakType[];
}

@ObjectType()
export class ActiveSessionType {
  @Field()
  recordId: string;

  @Field()
  clockIn: string;

  @Field()
  date: string;

  @Field({ nullable: true })
  activeBreakId?: string;

  @Field({ nullable: true })
  breakStartTime?: string;
}

@ObjectType()
export class AttendancePolicyType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field(() => Int)
  graceMinutes: number;

  @Field(() => Int, { nullable: true })
  autoClockOutMinutes?: number;

  @Field(() => Int)
  maxWorkHours: number;

  @Field(() => Int)
  minBreakMinutes: number;

  @Field(() => Int)
  maxBreakMinutes: number;

  @Field(() => Int)
  overtimeAfterMinutes: number;

  @Field()
  requireGpsLocation: boolean;

  @Field(() => Int)
  gpsRadiusMeters: number;

  @Field()
  allowMobileClockIn: boolean;

  @Field(() => [String])
  allowedMethods: string[];

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class AttendanceDailySummaryType {
  @Field()
  date: string;

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  present: number;

  @Field(() => Int)
  absent: number;

  @Field(() => Int)
  late: number;

  @Field(() => Int)
  onLeave: number;

  @Field(() => Int)
  earlyDeparture: number;

  @Field(() => Int)
  halfDay: number;

  @Field(() => Int)
  overtime: number;
}

@ObjectType()
export class PaginatedAttendanceType extends createPaginatedType(AttendanceRecordType) {}

export interface ActiveSession {
  recordId: string;
  clockIn: string;
  date: string;
  activeBreakId?: string;
  breakStartTime?: string;
  breakType?: BreakType;
}
