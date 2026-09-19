import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { TaxRegime } from '../../../../generated/prisma/client.js';

export class UpdateTaxProfileDto {
  @IsIn(['VAT_STANDARD', 'TURNOVER_TAX', 'EXEMPT'])
  taxRegime: TaxRegime;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  totRatePercent?: number;
}

export class ListTotPeriodsDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class PayTotPeriodDto {
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}