import { IsDecimal, IsEmail, IsIn, IsOptional, IsPhoneNumber, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  taxPin?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  contactEmail?: string;

  @IsOptional()
  @IsPhoneNumber()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'])
  currency?: string;
}

export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' }, { message: 'taxRate must be a decimal string' })
  taxRate?: string;

  @IsOptional()
  @IsIn(['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'])
  currency?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z{}:_#-]+$/, {
    message: 'invoiceNumberFormat must look like INV-YYYY-######',
  })
  @MaxLength(60)
  invoiceNumberFormat?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,0' }, { message: 'defaultPaymentTermsDays must be an integer string' })
  defaultPaymentTermsDays?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}$/, { message: 'financialYearStart must be MM-DD' })
  financialYearStart?: string;
}