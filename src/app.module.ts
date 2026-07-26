import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { CountrySelectionMiddleware } from './common/middleware/country-selection.middleware';
import { DatabaseModule } from './database/database.module';
import { ReferenceModelsModule } from './common/reference/reference.module';
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
import { ApiUsageModule } from './common/api-usage/api-usage.module';
import { HealthModule } from './modules/health/health.module';

// --- Customer surface (/api) — MIGRATION.md phase 2 ---
import { CustomerUsersModule } from './modules/api/users/customer-users.module';
import { MainModule } from './modules/api/main/main.module';
import { CustomerPropertiesModule } from './modules/api/properties/customer-properties.module';
import { CustomerBookingsModule } from './modules/api/bookings/customer-bookings.module';
import { WebsiteModule } from './modules/api/website/website.module';
import { JobsModule } from './modules/jobs/jobs.module';

/**
 * Modules serving the sh-account / extranet surface, mounted under `admin/v2`.
 */
const adminModules = [
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
  ApiUsageModule,
];

/**
 * Modules serving the sh-website customer surface, mounted under `api`.
 * Mirrors legacy `routes/api.js` (mounted at `/api` in `index.js:73`).
 */
const customerModules = [
  CustomerUsersModule,
  MainModule,
  CustomerPropertiesModule,
  CustomerBookingsModule,
  WebsiteModule,
];

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
    // `countries` model, needed by the country-selection middleware below.
    ReferenceModelsModule,
    ...adminModules,
    ...customerModules,
    // Background jobs — only actually schedule anything when ENABLE_CRON=true.
    JobsModule,
    // Liveness/readiness health checks — mounted at the ROOT (no prefix) for PM2/LB.
    HealthModule,
    // Prefixes are applied per surface here instead of a single global prefix, so the
    // admin (`admin/v2`) and customer (`api`) APIs can be served by one process while
    // nginx flips paths from legacy to nest one group at a time (MIGRATION.md phase 5).
    RouterModule.register([
      { path: 'admin/v2', children: adminModules },
      { path: 'api', children: customerModules },
    ]),
  ],
  providers: [
    // Apply the rate limiter to every route.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CountrySelectionMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Log every incoming request (all methods, all paths).
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
    // Legacy `app.use("/api", countrySelection)` — sets req.country / req.timezone
    // for every customer request; the search + booking services read req.timezone.
    consumer.apply(CountrySelectionMiddleware).forRoutes('api/*');
  }
}
