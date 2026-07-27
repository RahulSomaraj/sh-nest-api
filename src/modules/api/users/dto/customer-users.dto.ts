import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsMongoId, IsOptional, IsString } from "class-validator";

/**
 * Legacy validated none of these bodies (Mongoose schema validation was the only gate),
 * so fields are optional unless the handler cannot run without them. Adding stricter
 * rules here would turn legacy 200/500 responses into 400s and break the website.
 */

export class RegisterUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
}

export class CheckLoginDto {
  @ApiPropertyOptional() @IsOptional() @IsString() username?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
}

export class CustomerLoginDto {
  @ApiProperty() @IsString() email: string;
  @ApiProperty() @IsString() password: string;
}

export class ResetPasswordDto {
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
}

export class EditProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateOfBirth?: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional() @IsOptional() @IsString() newpassword?: string;
}

export class FbLoginDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
}

export class NotifyCredDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() user_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() device_token?: string;
}

export class FavoritesDto {
  @ApiProperty() @IsMongoId() propertyId: string;
}

export class GuestUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
}
