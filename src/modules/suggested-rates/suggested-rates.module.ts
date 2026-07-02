import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';
import { MailService } from '../../common/mail/mail.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';

// 'property' (bogus legacy path) dropped — StrictPopulateError under Mongoose 8.
const listPopulations = [{ path: 'property_id' }];

/**
 * Port of stayhopper/admin/controllers/v2/suggested-rates.js -> /admin/v2/suggested-rates
 * GET /            -> rooms with an active price suggestion (paginated)
 * PUT /:roomId/:rateId -> accept a suggested rate (applies suggested band, clears suggestion,
 *                          bumps property.max_day_price_percentage_to_normal_price, emails owner)
 * Permission: LIST_ADMINISTRATORS.
 */
@Injectable()
export class SuggestedRatesService {
  constructor(
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    private readonly mailService: MailService,
  ) {}

  async list(query: any, basePath = '/admin/v2/suggested-rates') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const where = { isExistPriceSuggestion: true };
    const [list, itemCount] = await Promise.all([
      this.roomModel.find(where).populate(listPopulations).sort(sort).limit(limit).skip(skip).lean().exec(),
      this.roomModel.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    const pages: { number: number; url: string }[] = [];
    const maxPages = 10;
    let start = Math.max(1, activePage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });

    return { list, itemCount, pageCount, pages, active_page: activePage };
  }

  private extranetUrl(): string {
    switch (process.env.NODE_ENV) {
      case 'production':
        return 'https://account.stayhopper.com/app/suggested-rates';
      case 'staging':
        return 'https://account.staging.stayhopper.com/app/suggested-rates';
      case 'development':
        return 'http://localhost:3001/app/suggested-rates';
      default:
        return '';
    }
  }

  async accept(roomId: string, rateId: string, body: any) {
    const resource: any = await this.roomModel.findOne({ _id: roomId, 'rates._id': rateId });
    if (!resource) return { notFound: true };

    if (!resource.isExistPriceSuggestion) {
      return { noSuggestion: true };
    }

    const selectedRate = (body?.rates || []).find((r: any) => String(r._id) === String(rateId));
    const suggested = selectedRate?.suggested_rates?.[0];
    const rate = resource.rates.id(rateId);
    const suggestedRatePercentage = resource.suggestedRatePercentage;

    if (suggested) {
      rate.weekday = suggested.weekday;
      rate.weekend = suggested.weekend;
      rate.minimumBookingRate = suggested.minimumBookingRate;
    }
    rate.isExistPriceSuggestion = false;
    rate.suggested_rates = [];
    resource.isExistPriceSuggestion = false;
    resource.suggestedRatePercentage = 0;
    await resource.save();

    const property: any = await this.propertyModel
      .findOne({ _id: resource.property_id })
      .populate('currency');
    if (property) {
      property.max_day_price_percentage_to_normal_price = suggestedRatePercentage;
      await property.save();

      await this.mailService.sendRateSuggestionAccepted({
        toEmail: property.primaryReservationEmail,
        hotelName: property.name,
        extranetUrl: this.extranetUrl(),
        currency: ` ${property.currency?.code ?? ''}`,
        high: suggested,
        base: selectedRate,
      });
    }

    return { rate };
  }
}

@Controller('suggested-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_ADMINISTRATORS')
export class SuggestedRatesController {
  constructor(private readonly service: SuggestedRatesService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Put(':roomId/:rateId')
  async accept(@Param('roomId') roomId: string, @Param('rateId') rateId: string, @Body() body: any) {
    const result = await this.service.accept(roomId, rateId, body);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    if ((result as any).noSuggestion) {
      throw new HttpException({ message: 'Sorry, rate suggestions does not exist' }, HttpStatus.NOT_FOUND);
    }
    return (result as any).rate;
  }
}

@Module({
  imports: [ReferenceModelsModule, MailModule],
  controllers: [SuggestedRatesController],
  providers: [SuggestedRatesService],
})
export class SuggestedRatesModule {}
