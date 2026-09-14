import {
  IsEnum,
  IsNotEmptyObject,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  @IsNotEmptyObject()
  preferences?: Record<string, unknown>;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}