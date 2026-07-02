import { IsNotEmpty, IsString } from 'class-validator';

export class AutoLoginDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  autoLoginCode: string;
}
