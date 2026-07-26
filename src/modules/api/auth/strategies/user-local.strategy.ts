import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../users/schemas/user.schema';

/**
 * Port of `passport.use('local-user-login')` in `middleware/passport.js`.
 * Username field is `email` (the admin strategy uses `username` — do not confuse them).
 */
@Injectable()
export class UserLocalStrategy extends PassportStrategy(
  Strategy,
  'local-user-login',
) {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({ usernameField: 'email', passwordField: 'password', session: false });
  }

  async validate(email: string, password: string): Promise<UserDocument> {
    const user = await this.userModel
      .findOne({ email })
      .populate('city_id')
      .populate('country_id')
      .exec();
    if (!user) {
      throw new UnauthorizedException('Incorrect email.');
    }
    const isValidPassword = await user.validPassword(password);
    if (!isValidPassword) {
      throw new UnauthorizedException('Incorrect password.');
    }
    return user;
  }
}
