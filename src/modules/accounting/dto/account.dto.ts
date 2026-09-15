import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AccountType } from '../../../generated/prisma/client.js';

export class CreateAccountDto {
  @IsString()
  @Matches(/^[A-Z0-9]{1,12}$/, {
    message: 'Account code must be 1-12 characters of digits/letters (e.g. 1100)',
  })
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AccountBalanceDto {
  @IsOptional()
  @Type(() => Number)
  @IsBoolean()
  withBalances?: boolean;
}