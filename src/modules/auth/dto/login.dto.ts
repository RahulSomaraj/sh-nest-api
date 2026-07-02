import { IsNotEmpty, IsString } from 'class-validator';

// Frontend posts { username, password } (sagas/Auth.js -> Auth.login)
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
