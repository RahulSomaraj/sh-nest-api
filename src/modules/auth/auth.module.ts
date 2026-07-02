import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../../common/mail/mail.module';
import {
  Administrator,
  AdministratorSchema,
} from '../administrators/schemas/administrator.schema';
import { Role, RoleSchema } from '../administrators/schemas/role.schema';

@Module({
  imports: [
    PassportModule,
    MailModule,
    MongooseModule.forFeature([
      { name: Administrator.name, schema: AdministratorSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('apiSecret'),
        // Newly issued tokens now expire (legacy tokens never did). Configurable
        // via JWT_EXPIRES_IN; defaults to 7d.
        signOptions: { expiresIn: config.get<string>('jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  exports: [AuthService, MongooseModule],
})
export class AuthModule {}
