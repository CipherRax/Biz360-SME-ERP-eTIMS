import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class AdjustStockDto {
  /** Signed decimal, e.g. "50" (stock in) or "-5" (stock out). */
  @IsString()
  @Matches(/^-?\d{1,9}(\.\d{1,3})?$/, {
    message: 'quantity must be a signed decimal string with up to 3 places',
  })
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}