import { IsEmail, IsOptional, IsString } from 'class-validator';

// POST /administrators/onboarding (public, website-driven)
export class OnboardingDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  propertyName?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

// POST /administrators/onboarding/verify
export class OnboardingVerifyDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  activationCode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  propertyName?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
