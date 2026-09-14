import { IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Matches(/^[a-z0-9_:-]+$/i, {
    each: true,
    message: 'scopes may only contain letters, digits, _ : and -',
  })
  scopes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}