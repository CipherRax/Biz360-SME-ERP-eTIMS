import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';

export class PurchaseLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description?: string;

  @IsNumberString()
  quantity!: string;

  @IsNumberString()
  unitPrice!: string;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'taxRate must be a number with at most 2 decimal places',
  })
  taxRate?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'discountPct must be a number with at most 2 decimal places',
  })
  discountPct?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'lineDiscount must be a number with at most 2 decimal places',
  })
  lineDiscount?: string;
}

export class CreatePurchaseDto {
  @IsUUID()
  partyId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  supplierRef?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class UpdatePurchaseDto {
  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  supplierRef?: string;
}

export class VoidPurchaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  reason?: string;
}

export class PurchasePaymentDto {
  @IsUUID()
  purchaseInvoiceId!: string;

  @IsNumberString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a number with at most 2 decimal places',
  })
  amount!: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}