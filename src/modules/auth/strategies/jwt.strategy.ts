import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Administrator } from '../../administrators/schemas/administrator.schema';

/**
 * Mirrors passport.use('jwt-administrator') in middleware/passport.js:
 * Bearer token, secret = API_SECRET, looks up Administrator by _id and populates role.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-administrator') {
  constructor(
    config: ConfigService,
    @InjectModel(Administrator.name)
    private readonly administratorModel: Model<Administrator>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: config.get<string>('apiSecret'),
    });
  }

  async validate(payload: any) {
    if (!payload || !payload._id) {
      throw new UnauthorizedException('Payload empty');
    }
    const administrator = await this.administratorModel
      .findById(payload._id)
      .populate('role')
      .exec();
    if (!administrator) {
      throw new UnauthorizedException();
    }
    return administrator;
  }
}
