import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

/**
 * Mirrors passport.use('local-administrator-login') in middleware/passport.js.
 * usernameField is 'username' (the value carries the email), passwordField 'password'.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local-administrator-login') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'username', passwordField: 'password', session: false });
  }

  async validate(username: string, password: string): Promise<any> {
    const administrator = await this.authService.validateAdministrator(username, password);
    if (!administrator) {
      throw new UnauthorizedException('Incorrect email or password.');
    }
    return administrator;
  }
}
