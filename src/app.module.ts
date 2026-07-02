import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdministratorsModule } from './modules/administrators/administrators.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { UsersModule } from './modules/users/users.module';
import { UserRatingsModule } from './modules/user-ratings/user-ratings.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { CrudModule } from './modules/crud/crud.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { AppVersionModule } from './modules/app-version/app-version.module';
import { SuggestedRatesModule } from './modules/suggested-rates/suggested-rates.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    AuthModule,
    AdministratorsModule,
    CommissionsModule,
    UsersModule,
    UserRatingsModule,
    PropertiesModule,
    RoomsModule,
    CrudModule,
    LookupsModule,
    AppVersionModule,
    SuggestedRatesModule,
    BookingsModule,
    InvoicesModule,
    DashboardModule,
    PaymentsModule,
  ],
})
export class AppModule {}
