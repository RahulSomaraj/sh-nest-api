import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Editable User fields for PUT /users/:id (legacy modify() does findOneAndUpdate($set, body)).
 * All optional. Fields mirror stayhopper/db/models/users.js so the global whitelist pipe
 * doesn't strip legitimate updates.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  city_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  country_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  isGuestUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  favourites?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  status?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  promocodes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  device_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  device_token?: string;
}
