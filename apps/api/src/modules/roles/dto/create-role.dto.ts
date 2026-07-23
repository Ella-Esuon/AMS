import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  IsUUID,
  MinLength,
  MaxLength,
  Min,
  Max,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InputType, Field, Int } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class CreateRoleDto {
  @ApiProperty({ example: 'Shift Supervisor' })
  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'shift_supervisor', description: 'Auto-generated if not provided' })
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9_]+$/, { message: 'Slug must contain only lowercase letters, numbers and underscores' })
  slug?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1000 })
  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ description: 'Permission IDs to assign' })
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}

@InputType()
export class UpdateRoleDto {
  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}

@InputType()
export class AssignPermissionsDto {
  @ApiProperty({ description: 'Permission IDs to assign' })
  @Field(() => [String])
  @IsArray()
  @IsUUID('all', { each: true })
  permissionIds: string[];
}

@InputType()
export class CreatePermissionDto {
  @ApiProperty({ example: 'attendance' })
  @Field()
  @IsString()
  @MaxLength(100)
  resource: string;

  @ApiProperty({ example: 'create' })
  @Field()
  @IsString()
  @MaxLength(100)
  action: string;

  @ApiPropertyOptional({ default: 'tenant' })
  @Field({ nullable: true, defaultValue: 'tenant' })
  @IsOptional()
  @IsIn(['own', 'tenant', 'global'])
  scope?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}

@InputType()
export class CreatePolicyDto {
  @ApiProperty({ example: 'Department Read Policy' })
  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['ALLOW', 'DENY'] })
  @Field()
  @IsIn(['ALLOW', 'DENY'])
  effect: 'ALLOW' | 'DENY';

  @ApiProperty({ example: ['attendance', 'reports'] })
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  resources: string[];

  @ApiProperty({ example: ['read', 'export'] })
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  actions: string[];

  @ApiPropertyOptional({
   description: 'ABAC conditions JSON',
  type: Object,
  })
  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  conditions?: Record<string, any>;

  @ApiPropertyOptional({ default: 0 })
  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ description: 'User ID (null = tenant-wide policy)' })
  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
