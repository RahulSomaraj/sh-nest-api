import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import moment from 'moment';
import { MailService } from '../../../common/mail/mail.service';
import { MailchimpService } from '../../../common/mailchimp/mailchimp.service';
import { HALF_HOUR_TIMESLOTS } from '../../../common/util/timeslots';
import { ContactUs, ContactUsDocument } from './schemas/contact-us.schema';
import {
  NotificationChild,
  NotificationChildDocument,
} from './schemas/notification.schema';
import {
  UserRating,
  UserRatingDocument,
} from '../../user-ratings/schemas/user-rating.schema';

// The 48 half-hour slots legacy hardcodes in `website.js:507` — shared with the cron
// jobs, which index the `slots` collection by the same ordering.
export { HALF_HOUR_TIMESLOTS };

/**
 * The `/api/website`, `/api/contactus`, `/api/userratings` and `/api/notifications`
 * surfaces — MIGRATION.md 2f. Ported from the v1 controllers still mounted in
 * `routes/api.js`: `website.js`, `contactus.js`, `userratings.js`, `notifications.js`.
 */
@Injectable()
export class WebsiteService {
  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly mailchimp: MailchimpService,
    @InjectModel(ContactUs.name)
    private readonly contactUsModel: Model<ContactUsDocument>,
    @InjectModel(NotificationChild.name)
    private readonly notificationChildModel: Model<NotificationChildDocument>,
    @InjectModel(UserRating.name)
    private readonly userRatingModel: Model<UserRatingDocument>,
    @InjectModel('cities') private readonly cityModel: Model<any>,
    @InjectModel('faq') private readonly faqModel: Model<any>,
    @InjectModel('termsandconditions')
    private readonly termsAndConditionsModel: Model<any>,
  ) {}

  /** W1 — legacy `website.js:23`. Emails only; nothing is persisted. */
  async registerProperty(logoUrl: string, body: any) {
    await this.mail.sendWebsitePropertyRegistration(logoUrl, body);
    return {
      status: 1,
      message:
        'Thank you for registering property with us. Property will be reviewed and up in the app soon!',
    };
  }

  /** W2 — legacy `website.js:229`. Emails only; nothing is persisted. */
  async contact(logoUrl: string, body: any) {
    await this.mail.sendWebsiteContact(logoUrl, body);
    return {
      status: 1,
      message: 'Thank you for contacting us. Our team will get back to you soon.',
    };
  }

  /**
   * W3 — legacy `website.js:436`. The status codes below are load-bearing for the
   * website's newsletter widget: 500 for an invalid address, 409 for an existing one.
   * Returns the body plus the HTTP status for the controller to apply.
   */
  async subscribe(emailAddress: string): Promise<{
    httpStatus: number;
    body: { status: number; message: string };
  }> {
    const listId = this.config.get<string>('mailchimp.adminListId');
    try {
      const result = await this.mailchimp.subscribe(listId, emailAddress);
      if (result && result.errors.length > 0) {
        if (result.errors[0].error === 'Please provide a valid email address.') {
          return {
            httpStatus: 500,
            body: { status: 0, message: 'Please provide a valid email address.' },
          };
        }
        return {
          httpStatus: 409,
          body: {
            status: 0,
            message: `${result.errors[0].email_address} is already exists in our list`,
          },
        };
      }
      return {
        httpStatus: 200,
        body: {
          status: 1,
          message:
            "Your newsletter subscription has been confirmed. You've been added to our list and will hear from us soon.",
        },
      };
    } catch {
      return {
        httpStatus: 500,
        body: {
          status: 0,
          message: 'Could not subscribe to newsletter, Please check later.',
        },
      };
    }
  }

  /** W4 — legacy `website.js:483`. */
  async cities() {
    const cities = await this.cityModel.find({}).sort({ name: 1 }).lean().exec();
    return { status: 1, data: { cities } };
  }

  /**
   * W5 — legacy `website.js:492`. For today, the list starts at the next half-hour
   * boundary; for any other date the full 48 slots are returned. `next_slot` is always
   * that next boundary.
   */
  slots(date?: string) {
    const selectedDate = moment(date).format('YYYY-MM-DD');

    const start = moment();
    const remainder = 30 - (start.minute() % 30);
    const dateTime = moment(start).add(remainder, 'minutes');
    const slot = moment(dateTime).format('HH:mm');

    let requestedSlots: readonly string[] = HALF_HOUR_TIMESLOTS;
    if (selectedDate === moment().format('YYYY-MM-DD')) {
      const firstIndex = HALF_HOUR_TIMESLOTS.indexOf(slot, 0);
      requestedSlots = HALF_HOUR_TIMESLOTS.slice(firstIndex);
    }
    return { status: 1, data: requestedSlots, next_slot: slot };
  }

  /** W6 — legacy `contactus.js:12`. Persists the message, then emails support. */
  async contactUs(body: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }) {
    const contactus = new this.contactUsModel({
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message,
    });
    await contactus.save();

    await this.mail.sendContactUsMessage({
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message,
      // Legacy used `new Date().toLocaleString()` (server locale) for {{MSGDATE}}.
      date: new Date().toLocaleString(),
    });

    return { status: 'Success', message: 'Message send successfully' };
  }

  /** W7 — legacy `termsAndConditions.js:8`. */
  async termsAndConditions() {
    try {
      const result = await this.termsAndConditionsModel.find().lean().exec();
      return { status: 'Success', data: result };
    } catch {
      return { status: 'Failed', message: 'Terms and condition not found' };
    }
  }

  /** W8 — legacy `faq.js:8`. */
  async faq() {
    try {
      const faq = await this.faqModel.find().lean().exec();
      return { status: 'Success', data: faq };
    } catch (err) {
      return { status: 'Failed', message: (err as Error).message };
    }
  }

  /**
   * W9 — legacy `userratings.js:9`. One rating per (user, property); the property's
   * aggregate `user_rating` is deliberately NOT recomputed here (that block is
   * commented out in legacy — the admin approval flow owns it).
   */
  async createUserRating(
    userId: Types.ObjectId,
    body: {
      property: string;
      comment: string;
      ub_id: string;
      booking_id: string;
      value: number;
    },
  ): Promise<{
    httpStatus: number;
    body: { status: string; message: string };
  }> {
    const exists = await this.userRatingModel
      .findOne({ user: userId, property: body.property })
      .lean()
      .exec();
    if (exists) {
      return {
        httpStatus: 400,
        body: { status: 'Failed', message: 'Rating have Already been Saved' },
      };
    }

    const rating = new this.userRatingModel({
      user: userId,
      property: body.property,
      comment: body.comment,
      ub_id: body.ub_id,
      booking_id: body.booking_id,
      value: Math.round(body.value) || 1,
      date: new Date(),
    });

    try {
      await rating.save();
    } catch {
      return {
        httpStatus: 200,
        body: { status: 'Failed', message: 'Rating details could not save' },
      };
    }
    return {
      httpStatus: 200,
      body: { status: 'Success', message: 'Rating details saved successfully' },
    };
  }

  /**
   * Shared projection for the two notification reads — joins each child row to its
   * parent notification and flattens the fields the app expects.
   */
  private notificationPipeline(match: Record<string, unknown>, sort: Record<string, 1 | -1>) {
    return [
      { $match: match },
      { $sort: sort },
      {
        $lookup: {
          from: 'notifications',
          localField: 'notification_id',
          foreignField: '_id',
          as: 'notification',
        },
      },
      {
        $project: {
          _id: '$_id',
          read_status: '$read_status',
          user_id: '$user_id',
          notification_id: '$notification_id',
          notification_type: { $arrayElemAt: ['$notification.notification_type', 0] },
          title: { $arrayElemAt: ['$notification.title', 0] },
          body: { $arrayElemAt: ['$notification.description', 0] },
          book_id: { $arrayElemAt: ['$notification.book_id', 0] },
          booking_no: { $arrayElemAt: ['$notification.booking_no', 0] },
          property_name: { $arrayElemAt: ['$notification.property_name', 0] },
          property_id: { $arrayElemAt: ['$notification.property_id', 0] },
        },
      },
    ];
  }

  /**
   * W10 — legacy `notifications.js:13`.
   * ⚠ Unauthenticated in legacy: `user_id` comes from the query string, so anyone can
   * read anyone's notifications. Parity is preserved for the cutover; hardening (scope
   * to the authed user) is on the post-cutover backlog in MIGRATION.md 2g.
   */
  async newNotifications(userId?: string) {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return { status: 'Failed', message: 'Notifications not found' };
    }
    try {
      const notifications = await this.notificationChildModel
        .aggregate(
          this.notificationPipeline(
            { user_id: new Types.ObjectId(userId) },
            { read_status: 1, _id: -1 },
          ),
        )
        .exec();
      return { status: 'Success', data: notifications };
    } catch (err) {
      return { status: 'Failed', message: (err as Error).message };
    }
  }

  /** W11 — legacy `notifications.js:74`. */
  async readNotification(id: string) {
    await this.notificationChildModel
      .updateOne({ _id: id }, { $set: { read_status: true } })
      .exec();
    return { status: 'Success', message: 'Notification read successfully!' };
  }

  /**
   * W12 — legacy `notifications.js:83`. Always answers `Success`; a bad/absent user id
   * yields `count: 0` (legacy swallowed the cast error to reach the same result).
   */
  async notificationCount(userId?: string) {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return { status: 'Success', count: 0 };
    }
    try {
      const count = await this.notificationChildModel
        .countDocuments({ user_id: new Types.ObjectId(userId), read_status: false })
        .exec();
      return { status: 'Success', count };
    } catch {
      return { status: 'Success', count: 0 };
    }
  }
}
