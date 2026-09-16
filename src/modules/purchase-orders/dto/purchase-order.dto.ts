import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const DECIMAL_2DP = /^\d{1,9}(\.\d{1,2})?$/;
const DECIMAL_3DP = /^\d{1,9}(\.\d{1,3})?$/;

export class PurchaseOrderLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  description?: string;

  @IsNumberString()
  @Matches(DECIMAL_3DP, {
    message: 'quantity must be a number with at most 3 decimal places',
  })
  quantity!: string;

  @IsNumberString()
  @Matches(DECIMAL_2DP, {
    message: 'unitPrice must be a number with at most 2 decimal places',
  })
  unitPrice!: string;

  @IsOptional()
  @IsNumberString()
  @Matches(DECIMAL_2DP, {
    message: 'taxRate must be a number with at most 2 decimal places',
  })
  taxRate?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(DECIMAL_2DP, {
    message: 'discountPct must be a number with at most 2 decimal places',
  })
  discountPct?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(DECIMAL_2DP, {
    message: 'lineDiscount must be a number with at most 2 decimal places',
  })
  lineDiscount?: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  partyId!: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

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
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines?: PurchaseOrderLineDto[];
}

export class ApprovePurchaseOrderDto {}

export class RejectPurchaseOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  reason!: string;
}