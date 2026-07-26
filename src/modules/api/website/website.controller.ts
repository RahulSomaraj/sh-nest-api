import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { WebsiteService } from './website.service';
import {
  ContactUsDto,
  CreateUserRatingDto,
  ReadNotificationDto,
  WebsiteContactDto,
  WebsiteRegisterDto,
  WebsiteSubscribeDto,
} from './dto/website.dto';
import { UserAuthGuard } from '../auth/guards/user-auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';

/** Legacy built the logo URL from the inbound request; keep the same absolute form. */
function logoUrlFor(req: Request): string {
  return `${req.protocol}://${req.get('host')}/public/img/StayhopperLogoRedWHite.png`;
}

/** W1–W5 — legacy `controllers/api/website.js`, mounted at `/api/website`. */
@ApiTags('customer: website')
@Controller('website')
export class WebsiteController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Post('register')
  register(@Req() req: Request, @Body() body: WebsiteRegisterDto) {
    return this.websiteService.registerProperty(logoUrlFor(req), body);
  }

  @Post('contact')
  contact(@Req() req: Request, @Body() body: WebsiteContactDto) {
    return this.websiteService.contact(logoUrlFor(req), body);
  }

  @Post('subscribe')
  async subscribe(
    @Body() body: WebsiteSubscribeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.websiteService.subscribe(body.email_address);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get('cities')
  cities() {
    return this.websiteService.cities();
  }

  @Get('slots')
  slots(@Query('date') date?: string) {
    return this.websiteService.slots(date);
  }
}

/** W6 — legacy `controllers/api/contactus.js`, mounted at `/api/contactus`. */
@ApiTags('customer: website')
@Controller('contactus')
export class ContactUsController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Post()
  create(@Body() body: ContactUsDto) {
    return this.websiteService.contactUs({
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message,
    });
  }
}

/** W7 — legacy `controllers/api/termsAndConditions.js`. */
@ApiTags('customer: website')
@Controller('terms-and-conditions')
export class CustomerTermsAndConditionsController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get()
  list() {
    return this.websiteService.termsAndConditions();
  }
}

/** W8 — legacy `controllers/api/faq.js`. */
@ApiTags('customer: website')
@Controller('faq')
export class CustomerFaqController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get()
  list() {
    return this.websiteService.faq();
  }
}

/** W9 — legacy `controllers/api/userratings.js`. */
@ApiTags('customer: website')
@Controller('userratings')
export class CustomerUserRatingsController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Post()
  @UseGuards(UserAuthGuard)
  async create(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: CreateUserRatingDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.websiteService.createUserRating(userId, {
      property: body.property,
      comment: body.comment,
      ub_id: body.ub_id,
      booking_id: body.booking_id,
      value: body.value,
    });
    res.status(result.httpStatus);
    return result.body;
  }
}

/**
 * W10–W12 — legacy `controllers/api/notifications.js`.
 * The base `GET /api/notifications` route is a hardcoded failure stub in legacy and is
 * intentionally not ported (MIGRATION.md 2f SKIP).
 */
@ApiTags('customer: website')
@Controller('notifications')
export class CustomerNotificationsController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get('new')
  listNew(@Query('user_id') userId?: string) {
    return this.websiteService.newNotifications(userId);
  }

  @Post('read')
  read(@Body() body: ReadNotificationDto) {
    return this.websiteService.readNotification(body.id);
  }

  @Get('notification_count')
  count(@Query('user_id') userId?: string) {
    return this.websiteService.notificationCount(userId);
  }
}
