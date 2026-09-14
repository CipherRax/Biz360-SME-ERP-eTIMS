import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create/update payload for an inventory item. Prices are decimal strings
 * (avoiding float drift); Prisma stores them as DECIMAL(18,2).
 */
export class ItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/, {
    message: 'sku must be 1-64 characters with only letters, digits and dashes',
  })
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  baseUnit?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,6}(\.\d{1,2})?$/, {
    message: 'buyPrice must be a decimal string with up to 2 places',
  })
  buyPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,6}(\.\d{1,2})?$/, {
    message: 'sellPrice must be a decimal string with up to 2 places',
  })
  sellPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  taxCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/, {
    message: 'reorderLevel must be a decimal string with up to 3 places',
  })
  reorderLevel?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}