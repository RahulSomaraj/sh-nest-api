import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * DTOs for the `/api` misc surface. Legacy performed no validation at all on these
 * bodies, so everything is optional unless the handler would throw without it —
 * keeping 4xx responses from appearing where legacy returned 200.
 */

export class WebsiteRegisterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email_address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hotel_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
}

export class WebsiteContactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email_address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() message?: string;
}

export class WebsiteSubscribeDto {
  // Not @IsEmail: Mailchimp itself validates and the website relies on the exact
  // "Please provide a valid email address." message it returns.
  @ApiPropertyOptional() @IsOptional() @IsString() email_address?: string;
}

export class ContactUsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() message?: string;
}

export class CreateUserRatingDto {
  @ApiProperty() @IsMongoId() property: string;

  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;

  @ApiProperty() @IsMongoId() ub_id: string;

  @ApiPropertyOptional() @IsOptional() @IsString() booking_id?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() value?: number;
}

export class ReadNotificationDto {
  @ApiProperty() @IsMongoId() id: string;
}
