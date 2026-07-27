import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Search/detail bodies. Legacy validated nothing beyond the four date/time fields on
 * `/search`, so everything else stays optional to avoid turning a legacy 200 into a 400.
 * (Moved out of the controller file so the @nestjs/swagger CLI plugin — which only
 * processes *.dto.ts files — documents the fields.)
 */
export class PropertySearchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() checkinDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkoutDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkinTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkoutTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bookingType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() countryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberAdults?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberChildren?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberRooms?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() properties?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rooms?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isTestingRates?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orderBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() priceMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() priceMax?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() propertyTypes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() propertyRatings?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() roomTypes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bedTypes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() amenities?: string;
}

export class PropertyDetailDto {
  @ApiPropertyOptional() @IsOptional() @IsString() checkinDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkoutDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkinTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() checkoutTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bookingType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberAdults?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberChildren?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() numberRooms?: number;
}
