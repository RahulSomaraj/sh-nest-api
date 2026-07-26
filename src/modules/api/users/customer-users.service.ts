import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import generator from 'generate-password';
import moment from 'moment';
import { MailService } from '../../../common/mail/mail.service';
import { MailchimpService } from '../../../common/mailchimp/mailchimp.service';
import { downloadImage } from '../../../common/util/remote-image.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  UserRating,
  UserRatingDocument,
} from '../../user-ratings/schemas/user-rating.schema';

/** A handler result carrying the HTTP status legacy set explicitly. */
interface StatusResult<T> {
  httpStatus: number;
  body: T;
}

const EMAIL_REGEX =
  /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

/**
 * Customer account surface — MIGRATION.md 2b.
 * Ported from `controllers/api/v2/users.js` plus the two `controllers/api/v3/guestUser.js`
 * routes. Response envelopes (including the inconsistent `status` field — sometimes
 * `"Success"`, sometimes `1`, sometimes absent) are reproduced exactly.
 */
@Injectable()
export class CustomerUsersService {
  private readonly logger = new Logger(CustomerUsersService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly mailchimp: MailchimpService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserRating.name)
    private readonly userRatingModel: Model<UserRatingDocument>,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings')
    private readonly completedBookingModel: Model<any>,
  ) {}

  /**
   * Legacy signs the FULL user document as the JWT payload (`jwt.sign(user.toJSON(), …)`)
   * with no expiry. The `jwt-user` strategy only reads `_id`, but sh-website reads other
   * claims out of the token, so the whole document is kept — minus the password hash,
   * which legacy leaked into the token on the `/users` and `/fb-login` paths.
   */
  private signUserToken(user: UserDocument | Record<string, unknown>): string {
    const payload: Record<string, unknown> =
      typeof (user as UserDocument).toJSON === 'function'
        ? (user as UserDocument).toJSON()
        : { ...(user as Record<string, unknown>) };
    delete payload.password;
    return this.jwt.sign(payload);
  }

  private generatePassword(): string {
    return generator.generate({ length: 10, numbers: true });
  }

  /** U1 — `POST /api/users` (legacy `users.js:30`). Password is generated and emailed. */
  async register(body: {
    name?: string;
    email?: string;
    mobile?: string;
    country?: string;
    dateOfBirth?: string;
    gender?: string;
    device_type?: string;
  }): Promise<StatusResult<Record<string, unknown>>> {
    const emailExists = await this.userModel.findOne({ email: body.email }).exec();
    if (emailExists) {
      return {
        httpStatus: 409,
        body: { message: 'Account exists with same email' },
      };
    }

    const password = this.generatePassword();
    const user = new this.userModel({
      name: body.name,
      email: body.email,
      mobile: body.mobile,
      country: body.country,
      dateOfBirth: body.dateOfBirth,
      isGuestUser: 0,
      ...(body.gender ? { gender: body.gender } : {}),
      password: await bcrypt.hash(password, 10),
    });

    try {
      await user.save();
    } catch (error) {
      return { httpStatus: 500, body: { status: 'Failed', errors: validationErrors(error) } };
    }

    await this.mail.sendCustomerWelcome(user.email, user.name, password);

    // Legacy responded before awaiting Mailchimp; the subscribe is still best-effort but
    // is awaited here so the process cannot be torn down mid-call.
    const listId = this.mailchimp.listIdForDeviceType(body.device_type);
    if (listId) await this.mailchimp.subscribeQuietly(listId, user.email);

    return {
      httpStatus: 200,
      body: {
        message: 'Registration successful',
        token: this.signUserToken(user),
        user,
      },
    };
  }

  /** U2 — `POST /api/users/checklogin` (legacy `users.js:123`). Always HTTP 200. */
  async checkLogin(username?: string, password?: string) {
    const user = await this.userModel.findOne({ email: username }).exec();
    if (user && password) {
      const valid = await bcrypt.compare(password, user.password);
      if (valid) {
        const plain = user.toObject();
        delete plain.password;
        return { status: 'Success', data: plain };
      }
    }
    return { status: 'Failed', message: 'Invalid Login credentials!' };
  }

  /**
   * U3 — `POST /api/users/login` (legacy `users.js:138`). The credential check itself is
   * the `local-user-login` strategy; this runs the post-auth deleted-account check.
   */
  async login(authenticated: UserDocument): Promise<StatusResult<Record<string, unknown>>> {
    const userRecord = await this.userModel.findById(authenticated._id).exec();
    if (userRecord?.deleted) {
      return {
        httpStatus: 400,
        body: { message: 'This account has been deleted.' },
      };
    }

    const user = authenticated.toJSON() as Record<string, unknown>;
    delete user.password;
    return {
      httpStatus: 200,
      body: {
        message: 'Login successful',
        token: this.signUserToken(user),
        user,
      },
    };
  }

  /** U6 — `GET /api/users/logout` (legacy `users.js:212`). Clears the push credentials. */
  async logout(userId: Types.ObjectId) {
    await this.userModel
      .updateOne({ _id: userId }, { $set: { device_type: null, device_token: null } })
      .exec();
    return { message: 'User is logged out' };
  }

  /**
   * U7 — `POST /api/users/reset-password` (legacy `users.js:243`).
   * ⚠ Unauthenticated by design: anyone can reset any account's password to a random
   * value that is mailed to the account owner. Parity kept for cutover; hardening
   * (reset link/token instead of a new password) needs frontend work.
   */
  async resetPassword(email?: string): Promise<StatusResult<Record<string, unknown>>> {
    const user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      return {
        httpStatus: 404,
        body: {
          status: 'Failed',
          message:
            'Could not reset password, No user is registered with provided email address',
        },
      };
    }

    const password = this.generatePassword();
    user.password = await bcrypt.hash(password, 10);
    await user.save();

    await this.mail.sendCustomerResetPassword(email, password);

    return {
      httpStatus: 200,
      body: {
        status: 'Success',
        message:
          'Password reset successfully. New Password is send to your registered email address',
      },
    };
  }

  /**
   * U8 — `GET /api/users/bookings` (legacy `users.js:290`).
   * `type=CURRENT` reads upcoming rows from `userbookings`; anything else reads paid rows
   * from `completed_bookings` and flags which ones the user has already reviewed.
   */
  async bookings(userId: Types.ObjectId, type?: string) {
    const reviews = (
      await this.userRatingModel.find({ user: userId }).select('ub_id').lean().exec()
    )
      .map((r) => r.ub_id?.toString())
      .filter(Boolean);

    let userbookings: any[] = [];
    if (type === 'CURRENT') {
      const currentDate = moment().format('YYYY-MM-DD');
      try {
        userbookings = await this.userBookingModel
          .find({
            $and: [
              { user: userId },
              { date_checkin: { $gte: new Date(currentDate) } },
            ],
          })
          .populate('property')
          .populate('room.room')
          .sort({ date_checkin: -1 })
          .exec();
      } catch {
        return { status: 'Failed', message: 'No bookings yet' };
      }
    } else {
      try {
        userbookings = await this.completedBookingModel
          .find({ $and: [{ user: userId }, { paid: true }] })
          .sort({ date_checkout: -1 })
          .lean()
          .exec();
        for (const booking of userbookings) {
          booking.reviewed_status =
            booking.ub_id !== undefined && reviews.includes(booking.ub_id.toString())
              ? 1
              : 0;
          if (!booking.currencyCode) booking.currencyCode = 'AED';
        }
      } catch {
        return { status: 'Failed', message: 'No bookings yet' };
      }
    }

    if (userbookings.length <= 0) {
      return { status: 'Failed', message: 'No bookings yet' };
    }
    return { status: 'Success', data: userbookings };
  }

  /** U9 — `POST /api/users/editprofile` (legacy `users.js:368`). Always HTTP 200. */
  async editProfile(
    userId: Types.ObjectId,
    body: {
      name?: string;
      mobile?: string;
      email?: string;
      gender?: string;
      country?: string;
      dateOfBirth?: string;
    },
    imagePath?: string,
  ) {
    const emailExists = await this.userModel
      .findOne({ email: body.email, _id: { $ne: userId } })
      .exec();
    if (emailExists) {
      return { status: 'Failed', message: 'Account exists with same email' };
    }

    const user = await this.userModel.findOne({ _id: userId }).select('-password').exec();
    if (!user) {
      return { status: 'Failed', message: 'Profile could not update' };
    }

    if (body.name) user.name = body.name;
    if (body.mobile) user.mobile = body.mobile;
    if (body.email) user.email = body.email;
    if (body.gender) user.gender = body.gender;
    if (body.country) user.country = body.country;
    if (body.dateOfBirth) user.dateOfBirth = body.dateOfBirth;
    if (imagePath) user.image = imagePath;

    try {
      await user.save();
    } catch (error) {
      this.logger.warn(`editprofile save failed: ${error}`);
      return { status: 'Failed', message: 'Profile could not update' };
    }
    return { status: 'Success', data: user };
  }

  /** U10 — `DELETE /api/users/delete-account` (legacy `users.js:448`). Soft delete. */
  async deleteAccount(userId: Types.ObjectId): Promise<StatusResult<Record<string, unknown>>> {
    const result = await this.userModel
      .updateOne({ _id: userId }, { $set: { deleted: true } })
      .exec();
    if (result.matchedCount === 0) {
      return { httpStatus: 404, body: { message: 'User not found.' } };
    }
    return {
      httpStatus: 200,
      body: { message: 'Account has been marked as deleted.' },
    };
  }

  /** U11 — `POST /api/users/change-password` (legacy `users.js:478`). Always HTTP 200. */
  async changePassword(userId: Types.ObjectId, newPassword?: string) {
    if (!newPassword) {
      return { status: 'Failed', message: 'Password could not change' };
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await this.userModel
      .updateOne({ _id: userId }, { $set: { password: hashed } })
      .exec();
    if (result.matchedCount === 0) {
      return { status: 'Failed', message: 'Password could not change' };
    }
    return { status: 'Success', message: 'Password changed successfully' };
  }

  /**
   * U12 — `POST /api/users/fb-login` (legacy `users.js:516`). Logs in (or creates) by
   * email and optionally mirrors the provider avatar into `public/files/userpics`.
   * The download is guarded — see `downloadImage` / MIGRATION.md 2g#6.
   */
  async fbLogin(body: {
    name?: string;
    email?: string;
    image?: string;
    device_type?: string;
  }) {
    // Legacy un-escaped `%26` up to four times; a single global replace is equivalent
    // for every input that had four or fewer occurrences and strictly better otherwise.
    const imageLink = body.image ? body.image.split('%26').join('&') : '';

    let user = await this.userModel.findOne({ email: body.email }).exec();
    const isNew = !user;

    if (!user) {
      user = new this.userModel({
        name: body.name,
        email: body.email,
        isGuestUser: 0,
        password: await bcrypt.hash(this.generatePassword(), 10),
      });
    }

    if (imageLink) {
      const dest = `./public/files/userpics/${user._id}.jpg`;
      const ok = await downloadImage(imageLink, dest);
      if (ok) user.image = `public/files/userpics/${user._id}.jpg`;
    }
    await user.save();

    if (isNew) {
      const listId = this.mailchimp.listIdForDeviceType(body.device_type);
      if (listId) await this.mailchimp.subscribeQuietly(listId, user.email);
    }

    const json = user.toJSON() as Record<string, unknown>;
    delete json.password;

    return {
      status: 1,
      message: 'Login successful',
      token: this.signUserToken(json),
      user: json,
      image: imageLink,
    };
  }

  /**
   * U13 — `POST /api/users/notify_cred` (legacy `users.js:594`). A device token belongs
   * to exactly one account, so any other holder is cleared first.
   */
  async notifyCred(body: {
    user_id?: string;
    device_type?: string;
    device_token?: string;
  }) {
    if (body.device_token) {
      await this.userModel
        .updateMany({ device_token: body.device_token }, { $set: { device_token: null } })
        .exec();
    }
    const result = await this.userModel
      .updateOne(
        { _id: body.user_id },
        { $set: { device_type: body.device_type, device_token: body.device_token } },
      )
      .exec();
    if (result.matchedCount === 0) {
      return { status: 'Failed', message: 'No such user exists' };
    }
    return {
      status: 'Success',
      message: 'Notification credentials set successfully!',
    };
  }

  /** U14 — `POST /api/users/favorites` (legacy `users.js:622`). Toggles the property. */
  async toggleFavorite(
    userId: Types.ObjectId,
    propertyId: string,
  ): Promise<StatusResult<Record<string, unknown>>> {
    const user = await this.userModel.findOne({ _id: userId }).exec();
    if (!user) {
      return { httpStatus: 404, body: { message: 'User not available' } };
    }

    const favourites = user.favourites || [];
    const alreadyFavourited = favourites.some(
      (pId) => pId.toString() === propertyId.toString(),
    );

    if (alreadyFavourited) {
      await this.userModel
        .updateOne({ _id: userId }, { $pull: { favourites: propertyId } })
        .exec();
    } else {
      await this.userModel
        .updateOne({ _id: userId }, { $push: { favourites: propertyId } })
        .exec();
    }

    return {
      httpStatus: 200,
      body: {
        message: alreadyFavourited ? 'Removed from favourites' : 'Added to favourites',
      },
    };
  }

  /**
   * U15 — `POST /api/v3/guestUser` (legacy `v3/guestUser.js:11`).
   *
   * MIGRATION.md 2g#2 — two legacy defects are NOT reproduced:
   *  1. the 400 for an invalid email had no `return`, so the handler carried on and
   *     issued a token anyway (double-send);
   *  2. when the email already belonged to a *real* (non-guest) account, that account's
   *     document was signed into a token and handed to the caller — anyone could take
   *     over any account by posting its email address.
   * Here an invalid email stops at 400, and a non-guest match is refused.
   */
  async guestUser(email?: string): Promise<StatusResult<Record<string, unknown>>> {
    if (!email || !EMAIL_REGEX.test(email)) {
      return { httpStatus: 400, body: { message: 'Invalid email.' } };
    }

    try {
      const existing = await this.userModel.findOne({ email }).exec();
      if (existing) {
        if (Number(existing.isGuestUser) !== 1) {
          return {
            httpStatus: 409,
            body: {
              message: 'An account already exists with this email. Please log in.',
            },
          };
        }
        return {
          httpStatus: 200,
          body: {
            message: 'token generation successful',
            token: this.signUserToken(existing),
          },
        };
      }

      const user = new this.userModel({
        email,
        isGuestUser: 1,
        name: `GuestUser_${randomUUID()}`,
        password: await bcrypt.hash(this.generatePassword(), 10),
      });
      await user.save();

      return {
        httpStatus: 200,
        body: {
          message: 'token generation successful',
          token: this.signUserToken(user),
        },
      };
    } catch (error) {
      return {
        httpStatus: 500,
        body: { status: 'Failed', errors: validationErrors(error) },
      };
    }
  }

  /**
   * U16 — `POST /api/v3/checkIsGuestUser` (legacy `v3/guestUser.js:71`).
   * MIGRATION.md 2g#2: legacy fell through to a second `res.status(400)` after the
   * success response (an ERR_HTTP_HEADERS_SENT crash on the happy path); only the
   * intended single response is sent here.
   */
  async checkIsGuestUser(email?: string): Promise<StatusResult<Record<string, unknown>>> {
    if (!email) {
      return { httpStatus: 400, body: { message: 'Please Provide Email' } };
    }
    const user = await this.userModel.findOne({ email }).lean().exec();
    if (!user) {
      return { httpStatus: 400, body: { message: 'Invalid Email' } };
    }
    return {
      httpStatus: 200,
      body: { isGuestUser: user.isGuestUser, email },
    };
  }
}

/** Flatten a Mongoose ValidationError into the `errors: string[]` legacy returned. */
function validationErrors(error: unknown): string[] {
  const errors: string[] = [];
  const fields = (error as { errors?: Record<string, { message: string }> })?.errors;
  for (const field in fields) {
    errors.push(fields[field].message);
  }
  return errors;
}
