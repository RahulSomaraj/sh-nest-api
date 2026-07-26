import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Types } from 'mongoose';
import { IsOptional, IsString } from 'class-validator';
import { CustomerBookingsService } from './customer-bookings.service';
import { UserAuthGuard } from '../auth/guards/user-auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { CountryAwareRequest } from '../../../common/middleware/country-selection.middleware';

class CheckPromoDto {
  @IsString() promocode: string;
  @IsOptional() @IsString() email?: string;
}

class BookIdDto {
  @IsString() book_id: string;
}

/** B1–B3 — legacy `controllers/api/v2/bookings.js`, mounted at `/api/bookings`. */
@ApiTags('customer: bookings')
@Controller('bookings')
export class CustomerBookingsController {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  @Post('checkpromo')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  checkPromo(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: CheckPromoDto,
  ) {
    return this.bookingsService.checkPromo(userId, body.email, body.promocode);
  }

  /**
   * B2 — the booking body is large, loosely-shaped and nested (rooms arrive as a
   * `{ roomId: quantity }` map), so it is taken raw to survive the global whitelist pipe.
   */
  @Post()
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  create(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: Record<string, unknown>,
    @Req() req: CountryAwareRequest,
  ) {
    return this.bookingsService.createBooking(userId, body, req.timezone);
  }

  /** B3 — unauthenticated by legacy design; see the service note. */
  @Get(':id')
  getByBookId(@Param('id') id: string) {
    return this.bookingsService.getByBookId(id);
  }
}

/** B4/B5 — legacy `controllers/api/v2/payment.js`, mounted at `/api/payment`. */
@ApiTags('customer: bookings')
@Controller('payment')
export class CustomerPaymentController {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  /**
   * Gateway return URL — unauthenticated because the gateway redirects the browser
   * here. Web clients get a redirect back to the website, app clients get JSON.
   */
  @Get('success')
  async success(@Query() query: Record<string, string>, @Res() res: Response) {
    const result = await this.bookingsService.paymentSuccess(query);
    if ('redirect' in result) return res.redirect(result.redirect);
    return res.json(result.body);
  }

  @Get('failed')
  async failed(@Query() query: Record<string, string>, @Res() res: Response) {
    const result = await this.bookingsService.paymentFailed(query);
    if ('redirect' in result) return res.redirect(result.redirect);
    return res.json(result.body);
  }
}

/**
 * B6/B7 — legacy `controllers/api/v3/showbookingsfilter.js` and
 * `controllers/api/v3/resendConfirmationMail.js`, mounted at `/api/v3`.
 */
@ApiTags('customer: bookings')
@Controller('v3')
export class CustomerBookingsV3Controller {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  @Post('myBookings')
  @HttpCode(200)
  myBookings(@Body() body: BookIdDto) {
    return this.bookingsService.myBookings(body.book_id);
  }

  @Post('resendConfirmMail')
  async resendConfirmMail(
    @Body() body: BookIdDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.bookingsService.resendConfirmMail(body.book_id);
    res.status(result.httpStatus);
    return result.body;
  }
}
