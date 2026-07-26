import { IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * DTOs for the `/api` misc surface. Legacy performed no validation at all on these
 * bodies, so everything is optional unless the handler would throw without it —
 * keeping 4xx responses from appearing where legacy returned 200.
 */

export class WebsiteRegisterDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email_address?: string;
  @IsOptional() @IsString() phone_number?: string;
  @IsOptional() @IsString() hotel_name?: string;
  @IsOptional() @IsString() city?: string;
}

export class WebsiteContactDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email_address?: string;
  @IsOptional() @IsString() phone_number?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() message?: string;
}

export class WebsiteSubscribeDto {
  // Not @IsEmail: Mailchimp itself validates and the website relies on the exact
  // "Please provide a valid email address." message it returns.
  @IsOptional() @IsString() email_address?: string;
}

export class ContactUsDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() message?: string;
}

export class CreateUserRatingDto {
  @IsMongoId() property: string;

  @IsOptional() @IsString() comment?: string;

  @IsMongoId() ub_id: string;

  @IsOptional() @IsString() booking_id?: string;

  @IsOptional() @IsNumber() value?: number;
}

export class ReadNotificationDto {
  @IsMongoId() id: string;
}
