import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { PlanType, TenantStatus } from '@prisma/client';

registerEnumType(PlanType, { name: 'PlanType' });
registerEnumType(TenantStatus, { name: 'TenantStatus' });

@ObjectType()
export class TenantType {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field({ nullable: true })
  domain?: string;

  @Field({ nullable: true })
  logo?: string;

  @Field(() => PlanType)
  plan: PlanType;

  @Field(() => TenantStatus)
  status: TenantStatus;

  @Field()
  maxUsers: number;

  @Field()
  contactEmail: string;

  @Field({ nullable: true })
  contactPhone?: string;

  @Field()
  timezone: string;

  @Field()
  dateFormat: string;

  @Field()
  timeFormat: string;

  @Field()
  locale: string;

  @Field()
  currency: string;

  @Field()
  primaryColor: string;

  @Field({ nullable: true })
  trialEndsAt?: Date;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field()
  userCount: number;
}

@ObjectType()
export class TenantStats {
  @Field()
  totalUsers: number;

  @Field()
  activeUsers: number;

  @Field()
  pendingUsers: number;

  @Field()
  departments: number;

  @Field()
  roles: number;
}
