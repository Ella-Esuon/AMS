import { PartialType, OmitType } from '@nestjs/swagger';
import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TenantStatus } from '@prisma/client';
import { CreateTenantDto } from './create-tenant.dto';

@InputType()
export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['slug'] as const)) {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  logo?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  timeFormat?: string;
}

@InputType()
export class UpdateTenantStatusDto {
  @Field()
  @IsEnum(TenantStatus)
  status: TenantStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  reason?: string;
}
