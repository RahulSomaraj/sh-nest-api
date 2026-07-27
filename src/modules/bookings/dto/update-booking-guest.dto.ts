import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * PUT /admin/v2/bookings/:id — GUEST DETAILS ONLY. Only these identity fields may be
 * changed; dates, room, status, and amounts are NOT editable here. Applied to `guestinfo`
 * on active bookings and `guestInfo` on completed bookings.
 */
export class UpdateBookingGuestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

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
}
