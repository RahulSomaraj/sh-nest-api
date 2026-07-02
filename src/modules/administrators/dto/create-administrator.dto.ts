import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Editable Administrator fields (password is generated server-side, like the legacy
 * create() handler). Empty city/country are dropped in the service to match legacy.
 */
export class CreateAdministratorDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsBoolean()
  status?: boolean;

  @IsOptional()
  @IsMongoId()
  role?: string;

  @IsOptional()
  @IsString()
  contact_person?: string;

  @IsOptional()
  @IsString()
  legal_name?: string;

  @IsOptional()
  @IsMongoId()
  country?: string;

  @IsOptional()
  @IsMongoId()
  city?: string;

  @IsOptional()
  @IsString()
  address_1?: string;

  @IsOptional()
  @IsString()
  address_2?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  latlng?: number[];

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  land_phone?: string;

  @IsOptional()
  @IsArray()
  alt_land_phone?: string[];

  @IsOptional()
  @IsNumber()
  rating?: number;
}
