import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { UserJwtStrategy } from './strategies/user-jwt.strategy';
import { UserLocalStrategy } from './strategies/user-local.strategy';
import { User, UserSchema } from '../../users/schemas/user.schema';

/**
 * Customer-surface authentication (`/api`). Registers the `jwt-user` and
 * `local-user-login` passport strategies and a JwtModule for issuing customer
 * tokens.
 *
 * The JwtModule here signs WITHOUT `expiresIn` — legacy `jwt.sign(user, secret)`
 * produces tokens with no `exp`, and sh-website relies on them not expiring
 * (MIGRATION.md 2g#9). The admin AuthModule keeps its own bounded-lifetime signer.
 *
 * This module owns no routes; feature modules import it for the guards/strategies.
 */
@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('apiSecret'),
      }),
    }),
  ],
  providers: [UserJwtStrategy, UserLocalStrategy],
  exports: [JwtModule, PassportModule, MongooseModule],
})
export class UserAuthModule {}
