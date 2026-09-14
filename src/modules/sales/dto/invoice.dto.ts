import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../generated/prisma/client.js';

export class InvoiceLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/, {
    message: 'quantity must be a decimal string with up to 3 places',
  })
  quantity?: string;

  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,2})?$/, {
    message: 'unitPrice must be a decimal string with up to 2 places',
  })
  unitPrice?: string;

  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'taxRate must be a percentage with up to 2 places',
  })
  taxRate?: string;

  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'discountPct must be a percentage with up to 2 places',
  })
  discountPct?: string;

  @IsOptional()
  @Matches(/^\d{1,9}(\.\d{1,2})?$/, {
    message: 'lineDiscount must be a decimal string with up to 2 places',
  })
  lineDiscount?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  partyId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;
}

export class PaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsString()
  @Matches(/^\d{1,9}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with up to 2 places',
  })
  amount!: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class VoidInvoiceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason?: string;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}