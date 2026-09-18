import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  WithholdingTaxPaymentType,
  WithholdingTaxResidency,
} from '../../../../generated/prisma/client.js';

export class UpsertWithholdingTaxRateDto {
  @IsEnum(WithholdingTaxPaymentType)
  paymentType!: WithholdingTaxPaymentType;

  @IsEnum(WithholdingTaxResidency)
  residency!: WithholdingTaxResidency;

  @IsString()
  @Matches(/^\d{1,4}(\.\d{1,4})?$/, { message: 'ratePercent must be a percentage (max 4 decimals)' })
  ratePercent!: string;

  @IsBoolean()
  @IsOptional()
  defaults?: boolean;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}

export class ComputeWithholdingTaxDto {
  @IsUUID()
  @Type(() => String)
  paymentId!: string;
}

export class RecordWithholdingTaxDto {
  @IsUUID()
  paymentId!: string;
}

export class ListWithholdingTaxDeductionsDto {
  @IsUUID()
  @IsOptional()
  paymentId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

export class WithholdingTaxCertificateDto {
  @IsUUID()
  @IsOptional()
  deductionId?: string;
}

export class CalculateWithholdingTaxDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}