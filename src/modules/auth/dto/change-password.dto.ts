import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Parity with the joi schema in v2/auth.js change-password
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  old_password: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  new_password: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  confirm_password: string;
}
