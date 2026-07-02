import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseCrudService } from '../../common/crud/base-crud.service';

/**
 * Thin per-resource services over BaseCrudService. Each injects its shared model (from
 * ReferenceModelsModule) and supplies the module title, route base, populate spec and
 * list filters. Business logic lives in BaseCrudService.
 */

@Injectable()
export class CountriesCrudService extends BaseCrudService {
  constructor(@InjectModel('countries') m: Model<any>) {
    super(m, { moduleTitle: 'Country', basePath: '/admin/v2/countries' });
  }
}

@Injectable()
export class CitiesCrudService extends BaseCrudService {
  constructor(
    @InjectModel('cities') m: Model<any>,
    @InjectModel('countries') private readonly countriesModel: Model<any>,
  ) {
    super(m, { moduleTitle: 'City', basePath: '/admin/v2/cities', populations: 'country', filters: ['country'] });
  }

  /** audit A16: v2 cities list uniquely added `countries` (sorted by name) to the
   *  envelope for the FE country dropdown — restored here. */
  async list(query: any) {
    const [envelope, countries] = await Promise.all([
      super.list(query),
      this.countriesModel.find().sort({ country: 1 }).lean().exec(),
    ]);
    return { ...envelope, countries };
  }
}

@Injectable()
export class CurrenciesCrudService extends BaseCrudService {
  constructor(@InjectModel('currencies') m: Model<any>) {
    super(m, { moduleTitle: 'Currency', basePath: '/admin/v2/currencies' });
  }
}

@Injectable()
export class ServicesCrudService extends BaseCrudService {
  constructor(@InjectModel('services') m: Model<any>) {
    super(m, { moduleTitle: 'Service', basePath: '/admin/v2/services' });
  }
}

@Injectable()
export class PropertyTypesCrudService extends BaseCrudService {
  constructor(@InjectModel('propertytypes') m: Model<any>) {
    super(m, { moduleTitle: 'Property Type', basePath: '/admin/v2/property-types' });
  }
}

@Injectable()
export class PropertyRatingsCrudService extends BaseCrudService {
  constructor(@InjectModel('propertyratings') m: Model<any>) {
    super(m, { moduleTitle: 'Property Rating', basePath: '/admin/v2/property-ratings' });
  }
}

@Injectable()
export class PoliciesCrudService extends BaseCrudService {
  constructor(@InjectModel('policies') m: Model<any>) {
    super(m, { moduleTitle: 'Policy', basePath: '/admin/v2/policies' });
  }
}

@Injectable()
export class TermsCrudService extends BaseCrudService {
  constructor(@InjectModel('terms') m: Model<any>) {
    super(m, { moduleTitle: 'Term', basePath: '/admin/v2/terms' });
  }
}

@Injectable()
export class RoomTypesCrudService extends BaseCrudService {
  constructor(@InjectModel('room_types') m: Model<any>) {
    super(m, { moduleTitle: 'Room Type', basePath: '/admin/v2/room-types' });
  }
}

@Injectable()
export class RoomNamesCrudService extends BaseCrudService {
  constructor(@InjectModel('room_names') m: Model<any>) {
    super(m, { moduleTitle: 'Room Name', basePath: '/admin/v2/room-names' });
  }
}

@Injectable()
export class BedTypesCrudService extends BaseCrudService {
  constructor(@InjectModel('bed_types') m: Model<any>) {
    super(m, { moduleTitle: 'Bed Type', basePath: '/admin/v2/bed-types' });
  }
}

@Injectable()
export class BedNumbersCrudService extends BaseCrudService {
  constructor(@InjectModel('bed_numbers') m: Model<any>) {
    super(m, { moduleTitle: 'Bed Number', basePath: '/admin/v2/bed-numbers' });
  }
}

@Injectable()
export class GuestNumbersCrudService extends BaseCrudService {
  constructor(@InjectModel('guest_numbers') m: Model<any>) {
    super(m, { moduleTitle: 'Guest Number', basePath: '/admin/v2/guest-numbers' });
  }
}

@Injectable()
export class FaqCrudService extends BaseCrudService {
  constructor(@InjectModel('faq') m: Model<any>) {
    super(m, { moduleTitle: 'FAQ', basePath: '/admin/v2/faq' });
  }
}

@Injectable()
export class OffersCrudService extends BaseCrudService {
  constructor(@InjectModel('offers') m: Model<any>) {
    super(m, { moduleTitle: 'Offer', basePath: '/admin/v2/offers' });
  }
}

@Injectable()
export class PromoCodesCrudService extends BaseCrudService {
  constructor(@InjectModel('promocodes') m: Model<any>) {
    super(m, { moduleTitle: 'Promo Code', basePath: '/admin/v2/promo-codes' });
  }
}

@Injectable()
export class TermsAndConditionsCrudService extends BaseCrudService {
  constructor(@InjectModel('termsandconditions') m: Model<any>) {
    super(m, { moduleTitle: 'Terms and Conditions', basePath: '/admin/v2/terms-and-conditions' });
  }
}
