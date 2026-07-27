import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  status?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contact_person?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address_2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  latlng?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  land_phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  alt_land_phone?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  rating?: number;
}
