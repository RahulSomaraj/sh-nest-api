import { Module } from '@nestjs/common';
import { ApiServicesModule } from '../services/api-services.module';
import { UserAuthModule } from '../auth/user-auth.module';
import { CustomerPropertiesController } from './customer-properties.controller';
import { CustomerPropertiesService } from './customer-properties.service';

/** MIGRATION.md 2d — the sh-website search + property-detail surface. */
@Module({
  imports: [ApiServicesModule, UserAuthModule],
  controllers: [CustomerPropertiesController],
  providers: [CustomerPropertiesService],
  exports: [CustomerPropertiesService],
})
export class CustomerPropertiesModule {}
