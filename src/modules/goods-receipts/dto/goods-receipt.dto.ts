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
  ValidateNested,
} from 'class-validator';

export class CreateGoodsReceiptLineDto {
  @IsUUID()
  poLineId!: string;

  @IsNumberString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,3})?$/, {
    message: 'quantity must be a positive number with at most 3 decimal places',
  })
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId!: string;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptLineDto)
  lines!: CreateGoodsReceiptLineDto[];
}

export class ConfirmGoodsReceiptDto {
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
