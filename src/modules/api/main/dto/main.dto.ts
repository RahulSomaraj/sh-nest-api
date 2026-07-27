import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Moved out of the controller file so the @nestjs/swagger CLI plugin — which
 * only processes *.dto.ts files — documents the fields.
 */
export class CityDto {
  @ApiProperty() @IsString() cityId: string;
}

export class CountryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() countryId?: string;
}
