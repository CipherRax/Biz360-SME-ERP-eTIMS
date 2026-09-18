import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { SupplierEtimsCaptureMethod } from '../../../../generated/prisma/client.js';

const MONEY_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

export class CreateSupplierEtimsInvoiceDto {
  @IsUUID()
  supplierId!: string;

  /** KRA-issued incremental invoice number printed on the receipt. */
  @IsString()
  @Matches(/^[A-Za-z0-9\/\-\s]{6,60}$/, {
    message: 'kraInvoiceNumber must be the invoice number printed by KRA',
  })
  kraInvoiceNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  kraControlUnitId?: string;

  /** Base64-encoded QR content captured from the paper receipt. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  kraQrCodeData?: string;

  @IsDateString()
  invoiceDate!: string;

  @IsString()
  @Matches(MONEY_PATTERN, {
    message: 'amount must be a positive amount with up to 2 decimals',
  })
  amount!: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  vatAmount?: string;

  @IsOptional()
  @IsEnum(SupplierEtimsCaptureMethod)
  captureMethod?: SupplierEtimsCaptureMethod;
}

export class ScanSupplierEtimsDto {
  @IsString()
  @MaxLength(1_200_000)
  data!: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class MatchSupplierEtimsDto {
  @IsUUID()
  purchaseInvoiceId!: string;
}