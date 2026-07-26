import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { MainService } from './main.service';
import { UserAuthGuard } from '../auth/guards/user-auth.guard';
import { CountryAwareRequest } from '../../../common/middleware/country-selection.middleware';

class CityDto {
  @IsString() cityId: string;
}

class CountryDto {
  @IsOptional() @IsString() countryId?: string;
}

/** M1–M13 — legacy `controllers/api/v2/main.js`, mounted at `/api/main`. */
@ApiTags('customer: main')
@Controller('main')
export class MainController {
  constructor(private readonly mainService: MainService) {}

  /** M1 — token probe; the guard is the whole handler. */
  @Post('authorized')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  authorized() {
    return {};
  }

  // Declared before `app/version/:appType` so the no-arg form still resolves.
  @Get('app/version')
  appVersionLatest() {
    return this.mainService.appVersion();
  }

  @Get('app/version/:appType')
  appVersion(@Param('appType') appType: string) {
    return this.mainService.appVersion(appType);
  }

  @Get('redirect/:encodedParams')
  redirect(@Param('encodedParams') encodedParams: string) {
    return this.mainService.redirect(encodedParams);
  }

  @Post('city')
  @HttpCode(200)
  city(@Body() body: CityDto, @Req() req: CountryAwareRequest) {
    return this.mainService.city(body.cityId, req.timezone);
  }

  @Get('home')
  home(@Req() req: CountryAwareRequest) {
    return this.mainService.home(req.timezone);
  }

  @Post('cities')
  @HttpCode(200)
  cities(@Body() body: CountryDto, @Req() req: CountryAwareRequest) {
    return this.mainService.cities(body?.countryId, req.timezone);
  }

  @Get('offers')
  offers() {
    return this.mainService.offers();
  }

  @Get('hotels-cheapest')
  hotelsCheapest(@Req() req: CountryAwareRequest) {
    return this.mainService.hotelsCheapest(req.timezone);
  }

  @Get('hotels-popular')
  hotelsPopular(@Req() req: CountryAwareRequest) {
    return this.mainService.hotelsPopular(req.timezone);
  }

  // --- v2: same data, served from a short-lived cache (MIGRATION.md 2g#7) ---

  @Post('v2/cities')
  @HttpCode(200)
  citiesV2(@Body() body: CountryDto, @Req() req: CountryAwareRequest) {
    return this.mainService.citiesV2(body?.countryId, req.timezone);
  }

  @Get('v2/offers')
  offersV2() {
    return this.mainService.offersV2();
  }

  @Get('v2/hotels-cheapest')
  hotelsCheapestV2(@Req() req: CountryAwareRequest) {
    return this.mainService.hotelsCheapestV2(req.timezone);
  }

  @Get('v2/hotels-popular')
  hotelsPopularV2(@Req() req: CountryAwareRequest) {
    return this.mainService.hotelsPopularV2(req.timezone);
  }
}
