import { PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartyStatus, PartyType } from '../../../generated/prisma/client.js';

export class CreatePartyDto {
  @IsEnum(PartyType)
  type!: PartyType;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /**
   * KRA PIN, e.g. A012345678Z. Unique per organization; required for eTIMS.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{10,11}$/, {
    message: 'taxId must look like a KRA PIN (10-11 alphanumeric)',
  })
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code' })
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,6}(\.\d{1,2})?$/, {
    message: 'creditLimit must be a decimal string with up to 2 places',
  })
  creditLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(PartyStatus)
  status?: PartyStatus;
}

/** Update payload — every field optional so partial PATCHes are accepted. */
export class UpdatePartyDto extends PartialType(CreatePartyDto) {}