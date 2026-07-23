import { ObjectType, Field, Int, ID, registerEnumType } from '@nestjs/graphql';
import { BreakType } from '@prisma/client';
import { createPaginatedType } from '../../../common/types/pagination.types';

// BreakType is already registered in attendance.types — do not re-register.
// Import it here only for typing.

// ─── ShiftBreakRuleType ───────────────────────────────────────────────────────

@ObjectType()
export class ShiftBreakRuleType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  shiftId: string;

  @Field()
  name: string;

  @Field(() => BreakType)
  breakType: BreakType;

  @Field(() => Int)
  startOffsetMins: number;

  @Field(() => Int)
  durationMinutes: number;

  @Field()
  isPaid: boolean;

  @Field()
  isRequired: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

// ─── ShiftType ────────────────────────────────────────────────────────────────

@ObjectType()
export class ShiftType {
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

  @Field({ description: 'Start time in HH:mm (24-hour)' })
  startTime: string;

  @Field({ description: 'End time in HH:mm (24-hour)' })
  endTime: string;

  @Field({ description: 'True when the shift ends on the next calendar day' })
  isNightShift: boolean;

  @Field(() => [Int], { description: 'ISO weekdays this shift runs: 1=Mon … 7=Sun' })
  workDays: number[];

  @Field(() => Int, { description: '0 = inherit grace from AttendancePolicy' })
  graceMinutes: number;

  @Field(() => Int, { nullable: true, description: 'null = inherit from AttendancePolicy' })
  overtimeAfterMinutes?: number;

  @Field({ nullable: true })
  colorCode?: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => [ShiftBreakRuleType])
  breakRules: ShiftBreakRuleType[];
}

// ─── ShiftAssignmentType ──────────────────────────────────────────────────────

@ObjectType()
export class ShiftAssignmentType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  shiftId?: string;

  @Field({ nullable: true })
  rotationId?: string;

  @Field()
  startDate: Date;

  @Field({ nullable: true })
  endDate?: Date;

  @Field()
  assignedBy: string;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  notes?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field({ nullable: true })
  shift?: ShiftType;
}

// ─── ShiftRotationSlotType ────────────────────────────────────────────────────

@ObjectType()
export class ShiftRotationSlotType {
  @Field(() => ID)
  id: string;

  @Field()
  rotationId: string;

  @Field({ nullable: true })
  shiftId?: string;

  @Field(() => Int, { description: 'Day offset within the rotation cycle (0-based)' })
  dayOffset: number;

  @Field({ nullable: true })
  shift?: ShiftType;
}

// ─── ShiftRotationType ────────────────────────────────────────────────────────

@ObjectType()
export class ShiftRotationType {
  @Field(() => ID)
  id: string;

  @Field()
  tenantId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int)
  cycleDays: number;

  @Field()
  startDate: Date;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => [ShiftRotationSlotType])
  slots: ShiftRotationSlotType[];
}

// ─── EffectiveShiftType ───────────────────────────────────────────────────────

@ObjectType()
export class EffectiveShiftType {
  @Field()
  shiftId: string;

  @Field()
  shiftName: string;

  @Field()
  scheduledIn: Date;

  @Field()
  scheduledOut: Date;

  @Field(() => Int)
  graceMinutes: number;

  @Field(() => Int, { nullable: true })
  overtimeAfterMinutes?: number;

  @Field()
  isNightShift: boolean;

  @Field(() => [ShiftBreakRuleType])
  breakRules: ShiftBreakRuleType[];
}

// ─── Paginated helpers ────────────────────────────────────────────────────────

@ObjectType()
export class PaginatedShiftsType extends createPaginatedType(ShiftType) {}

@ObjectType()
export class PaginatedAssignmentsType extends createPaginatedType(ShiftAssignmentType) {}

// ─── Service-facing interface (not GraphQL) ───────────────────────────────────

export interface EffectiveShift {
  shiftId: string;
  shiftName: string;
  scheduledIn: Date;
  scheduledOut: Date;
  graceMinutes: number;
  overtimeAfterMinutes: number | null;
  isNightShift: boolean;
  breakRules: {
    id: string;
    name: string;
    breakType: BreakType;
    startOffsetMins: number;
    durationMinutes: number;
    isPaid: boolean;
    isRequired: boolean;
  }[];
}
