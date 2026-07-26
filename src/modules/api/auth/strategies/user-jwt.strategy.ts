import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../users/schemas/user.schema';

/**
 * Port of `passport.use('jwt-user')` in `middleware/passport.js`: Bearer token signed
 * with API_SECRET, payload carries `_id`, loads the `users` document and populates
 * `city_id` / `country_id`.
 *
 * `ignoreExpiration` is TRUE on purpose (MIGRATION.md 2g#9): legacy user tokens are
 * signed without an `exp` claim and sh-website sessions are long-lived. Enforcing
 * expiry here would sign every existing customer out at cutover. Revisit after the
 * `/api` flip, together with the frontend.
 *
 * Separate from the admin `jwt-administrator` strategy — never interchangeable.
 */
@Injectable()
export class UserJwtStrategy extends PassportStrategy(Strategy, 'jwt-user') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: config.get<string>('apiSecret'),
    });
  }

  async validate(payload: any): Promise<UserDocument> {
    if (!payload || !payload._id) {
      throw new UnauthorizedException('Payload empty');
    }
    const user = await this.userModel
      .findById(payload._id)
      .populate('city_id')
      .populate('country_id')
      .exec();
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
