import { Module } from '@nestjs/common';
import { ReferenceModelsModule } from '../../../common/reference/reference.module';
import { CheckinService } from './checkin.service';
import { DateTimeService } from './date-time.service';
import { OffersService } from './offers.service';
import { PropertiesDataService } from './properties-data.service';
import { PropertyDetailService } from './property-detail.service';
import { SearchService } from './search.service';

/**
 * The ported `stayhopper/services/*.js` layer, shared by every `/api` feature module.
 *
 * Every model these services touch is registered in ReferenceModelsModule, so the
 * customer surface reads exactly the models the admin surface writes.
 */
@Module({
  imports: [ReferenceModelsModule],
  providers: [
    DateTimeService,
    CheckinService,
    OffersService,
    SearchService,
    PropertiesDataService,
    PropertyDetailService,
  ],
  exports: [
    DateTimeService,
    CheckinService,
    OffersService,
    SearchService,
    PropertiesDataService,
    PropertyDetailService,
    ReferenceModelsModule,
  ],
})
export class ApiServicesModule {}
