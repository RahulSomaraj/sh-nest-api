import { Module } from '@nestjs/common';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import * as Services from './crud.services';
import * as Controllers from './crud.controllers';

const services = [
  Services.CountriesCrudService,
  Services.CitiesCrudService,
  Services.CurrenciesCrudService,
  Services.ServicesCrudService,
  Services.PropertyTypesCrudService,
  Services.PropertyRatingsCrudService,
  Services.PoliciesCrudService,
  Services.TermsCrudService,
  Services.RoomTypesCrudService,
  Services.RoomNamesCrudService,
  Services.BedTypesCrudService,
  Services.BedNumbersCrudService,
  Services.GuestNumbersCrudService,
  Services.FaqCrudService,
  Services.OffersCrudService,
  Services.PromoCodesCrudService,
  Services.TermsAndConditionsCrudService,
];

const controllers = [
  Controllers.CountriesController,
  Controllers.CitiesController,
  Controllers.CurrenciesController,
  Controllers.ServicesController,
  Controllers.PropertyTypesController,
  Controllers.PropertyRatingsController,
  Controllers.PoliciesController,
  Controllers.TermsController,
  Controllers.RoomTypesController,
  Controllers.RoomNamesController,
  Controllers.BedTypesController,
  Controllers.BedNumbersController,
  Controllers.GuestNumbersController,
  Controllers.FaqController,
  Controllers.OffersController,
  Controllers.PromoCodesController,
  Controllers.TermsAndConditionsController,
];

/**
 * All 17 standard-CRUD resources (countries, cities, currencies, services,
 * property-types, property-ratings, policies, terms, room-types, room-names, bed-types,
 * bed-numbers, guest-numbers, faq, offers, promo-codes, terms-and-conditions) in one
 * module, sharing BaseCrudController/BaseCrudService. Models come from ReferenceModelsModule.
 */
@Module({
  imports: [ReferenceModelsModule],
  controllers,
  providers: services,
})
export class CrudModule {}
