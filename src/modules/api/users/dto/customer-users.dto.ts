import { IsMongoId, IsOptional, IsString } from 'class-validator';

/**
 * Legacy validated none of these bodies (Mongoose schema validation was the only gate),
 * so fields are optional unless the handler cannot run without them. Adding stricter
 * rules here would turn legacy 200/500 responses into 400s and break the website.
 */

export class RegisterUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() device_type?: string;
}

export class CheckLoginDto {
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
}

export class CustomerLoginDto {
  @IsString() email: string;
  @IsString() password: string;
}

export class ResetPasswordDto {
  @IsOptional() @IsString() email?: string;
}

export class EditProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
}

export class ChangePasswordDto {
  @IsOptional() @IsString() newpassword?: string;
}

export class FbLoginDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() device_type?: string;
}

export class NotifyCredDto {
  @IsOptional() @IsMongoId() user_id?: string;
  @IsOptional() @IsString() device_type?: string;
  @IsOptional() @IsString() device_token?: string;
}

export class FavoritesDto {
  @IsMongoId() propertyId: string;
}

export class GuestUserDto {
  @IsOptional() @IsString() email?: string;
}
