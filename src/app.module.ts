import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
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
    // Generous global rate limit — protects against abuse/brute-force without
    // affecting normal admin usage. 300 requests / minute per client IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
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
  providers: [
    // Apply the rate limiter to every route.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Log every incoming request (all methods, all paths).
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
