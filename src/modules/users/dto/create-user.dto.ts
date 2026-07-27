import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';

/**
 * POST /admin/v2/users — admin-created user. Mirrors the sh-account create form
 * (name/email/mobile/country/city) plus optional profile fields. Server-managed fields
 * (password, isGuestUser, status, favourites, promocodes, device_*) are set in the
 * service, never accepted from the client.
 */
export class CreateUserDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

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
}
