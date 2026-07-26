import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiServicesModule } from '../services/api-services.module';
import { UserAuthModule } from '../auth/user-auth.module';
import { MainController } from './main.controller';
import { MainService } from './main.service';
import { GeocoderService } from './geocoder.service';
import { AppVersionSchema } from '../../app-version/app-version.module';

/**
 * MIGRATION.md 2c — the sh-website home/discovery surface (`/api/main`).
 *
 * The `app_version` schema is shared with the admin module (same collection, same
 * model name), so both surfaces read the same rows.
 */
@Module({
  imports: [
    ApiServicesModule,
    UserAuthModule,
    MongooseModule.forFeature([{ name: 'app_version', schema: AppVersionSchema }]),
  ],
  controllers: [MainController],
  providers: [MainService, GeocoderService],
  exports: [MainService],
})
export class MainModule {}
