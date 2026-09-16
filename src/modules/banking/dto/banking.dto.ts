import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { BankAccountType } from '../../../generated/prisma/client.js';

export class CreateBankAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-999999999999)
  @Max(999999999999)
  openingBalance?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Update payload — every field optional so partial PATCHes are accepted. */
export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}

export class StatementLineDto {
  @IsDateString()
  transactionDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  debit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  credit?: number;
}

export class ImportStatementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[];
}

export class ReconcileDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  statementLineIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}