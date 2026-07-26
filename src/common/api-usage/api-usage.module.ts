import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiUsage, ApiUsageSchema } from './api-usage.schema';
import { ApiUsageService } from './api-usage.service';
import { ApiUsageInterceptor } from './api-usage.interceptor';
import { ApiUsageController } from './api-usage.controller';

/**
 * API usage tracking. Registers a global interceptor that counts every request by
 * method + route pattern, seeds the full route inventory at count:0 on boot, and exposes
 * an audit report so unused endpoints can be found and removed.
 *
 * The interceptor is provided via APP_INTERCEPTOR, so importing this module once in
 * AppModule activates tracking application-wide — no main.ts change required.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ApiUsage.name, schema: ApiUsageSchema }]),
  ],
  controllers: [ApiUsageController],
  providers: [
    ApiUsageService,
    { provide: APP_INTERCEPTOR, useClass: ApiUsageInterceptor },
  ],
})
export class ApiUsageModule {}
