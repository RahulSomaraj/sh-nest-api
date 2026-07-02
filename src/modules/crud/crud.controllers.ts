import { Controller } from '@nestjs/common';
import { BaseCrudController } from '../../common/crud/base-crud.controller';
import {
  CountriesCrudService,
  CitiesCrudService,
  CurrenciesCrudService,
  ServicesCrudService,
  PropertyTypesCrudService,
  PropertyRatingsCrudService,
  PoliciesCrudService,
  TermsCrudService,
  RoomTypesCrudService,
  RoomNamesCrudService,
  BedTypesCrudService,
  BedNumbersCrudService,
  GuestNumbersCrudService,
  FaqCrudService,
  OffersCrudService,
  PromoCodesCrudService,
  TermsAndConditionsCrudService,
} from './crud.services';

/**
 * Concrete standard-CRUD controllers. Each just binds a route base to its service; all
 * behaviour and route decorators are inherited from BaseCrudController. Route paths match
 * the sh-account frontend contract (ENDPOINTS.md).
 */

@Controller('countries')
export class CountriesController extends BaseCrudController {
  constructor(s: CountriesCrudService) { super(s); }
}

@Controller('cities')
export class CitiesController extends BaseCrudController {
  constructor(s: CitiesCrudService) { super(s); }
}

@Controller('currencies')
export class CurrenciesController extends BaseCrudController {
  constructor(s: CurrenciesCrudService) { super(s); }
}

@Controller('services')
export class ServicesController extends BaseCrudController {
  constructor(s: ServicesCrudService) { super(s); }
}

@Controller('property-types')
export class PropertyTypesController extends BaseCrudController {
  constructor(s: PropertyTypesCrudService) { super(s); }
}

@Controller('property-ratings')
export class PropertyRatingsController extends BaseCrudController {
  constructor(s: PropertyRatingsCrudService) { super(s); }
}

@Controller('policies')
export class PoliciesController extends BaseCrudController {
  constructor(s: PoliciesCrudService) { super(s); }
}

@Controller('terms')
export class TermsController extends BaseCrudController {
  constructor(s: TermsCrudService) { super(s); }
}

@Controller('room-types')
export class RoomTypesController extends BaseCrudController {
  constructor(s: RoomTypesCrudService) { super(s); }
}

@Controller('room-names')
export class RoomNamesController extends BaseCrudController {
  constructor(s: RoomNamesCrudService) { super(s); }
}

@Controller('bed-types')
export class BedTypesController extends BaseCrudController {
  constructor(s: BedTypesCrudService) { super(s); }
}

@Controller('bed-numbers')
export class BedNumbersController extends BaseCrudController {
  constructor(s: BedNumbersCrudService) { super(s); }
}

@Controller('guest-numbers')
export class GuestNumbersController extends BaseCrudController {
  constructor(s: GuestNumbersCrudService) { super(s); }
}

@Controller('faq')
export class FaqController extends BaseCrudController {
  constructor(s: FaqCrudService) { super(s); }
}

@Controller('offers')
export class OffersController extends BaseCrudController {
  constructor(s: OffersCrudService) { super(s); }
}

@Controller('promo-codes')
export class PromoCodesController extends BaseCrudController {
  constructor(s: PromoCodesCrudService) { super(s); }
}

@Controller('terms-and-conditions')
export class TermsAndConditionsController extends BaseCrudController {
  constructor(s: TermsAndConditionsCrudService) { super(s); }
}
