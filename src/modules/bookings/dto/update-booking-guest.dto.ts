import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * PUT /admin/v2/bookings/:id — GUEST DETAILS ONLY. Only these identity fields may be
 * changed; dates, room, status, and amounts are NOT editable here. Applied to `guestinfo`
 * on active bookings and `guestInfo` on completed bookings.
 */
export class UpdateBookingGuestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  mobile?: string;
}
