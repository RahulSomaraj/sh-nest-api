import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

// POST /administrators/onboarding (public, website-driven)
export class OnboardingDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  propertyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;
}

// POST /administrators/onboarding/verify
export class OnboardingVerifyDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activationCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  propertyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;
}
