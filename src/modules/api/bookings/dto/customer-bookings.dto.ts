import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Moved out of the controller file so the @nestjs/swagger CLI plugin — which
 * only processes *.dto.ts files — documents the fields.
 */
export class CheckPromoDto {
  @ApiProperty() @IsString() promocode: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
}

export class BookIdDto {
  @ApiProperty() @IsString() book_id: string;
}
