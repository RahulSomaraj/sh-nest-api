import { IsNotEmpty, IsString } from 'class-validator';

// Parity with the joi schema in v2/auth.js change-password
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  old_password: string;

  @IsString()
  @IsNotEmpty()
  new_password: string;

  @IsString()
  @IsNotEmpty()
  confirm_password: string;
}
