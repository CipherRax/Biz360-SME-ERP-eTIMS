import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCreditNoteLineDto {
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

export class CreateCreditNoteDto {
  @IsUUID()
  partyId!: string;

  @IsOptional()
  @IsUUID()
  referenceInvoiceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteLineDto)
  lines!: CreateCreditNoteLineDto[];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsDateString()
  noteDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;
}

export class IssueCreditNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason?: string;
}