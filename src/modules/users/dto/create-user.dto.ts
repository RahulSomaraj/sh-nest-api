import { IsEmail, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';

/**
 * POST /admin/v2/users — admin-created user. Mirrors the sh-account create form
 * (name/email/mobile/country/city) plus optional profile fields. Server-managed fields
 * (password, isGuestUser, status, favourites, promocodes, device_*) are set in the
 * service, never accepted from the client.
 */
export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;

  @IsOptional()
  @IsMongoId()
  city_id?: string;

  @IsOptional()
  @IsMongoId()
  country_id?: string;

  @IsOptional()
  @IsString()
  image?: string;
}
