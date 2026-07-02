import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import sgMail from '@sendgrid/mail';

/**
 * Wraps @sendgrid/mail, mirroring the email flows in the legacy v2 controllers
 * (reset-password, welcome, hotel-admin activation). HTML templates are read from
 * the configured emails/public dirs and have {{PLACEHOLDER}} tokens substituted.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('mail.sendgridApiKey');
    if (key) {
      sgMail.setApiKey(key);
    }
  }

  private render(filePath: string, replacements: Record<string, string>): string {
    let html: string;
    try {
      html = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      this.logger.warn(`Email template not found at ${filePath}; sending minimal fallback`);
      html = Object.keys(replacements)
        .map((k) => `<p>${k}: ${replacements[k]}</p>`)
        .join('');
    }
    for (const [token, value] of Object.entries(replacements)) {
      html = html.replace(`{{${token}}}`, value ?? '');
    }
    return html;
  }

  /**
   * Generic templated send with GLOBAL token replacement (booking cancel/no-show emails
   * reuse tokens like {{DATE}}, {{HOTEL_NAME}} multiple times). Template lives in publicDir.
   */
  async sendTemplated(params: {
    template: string;
    replacements: Record<string, string>;
    to?: string;
    bcc?: string[];
    subject: string;
    text?: string;
  }): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.publicDir, params.template);
    let html: string;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (e) {
      this.logger.warn(`Email template not found at ${file}; sending minimal fallback`);
      html = Object.entries(params.replacements)
        .map(([k, v]) => `<p>${k}: ${v}</p>`)
        .join('');
    }
    for (const [token, value] of Object.entries(params.replacements)) {
      html = html.split(`{{${token}}}`).join(value ?? '');
    }
    const msg: any = {
      from: { email: m.fromEmail, name: m.fromName },
      subject: params.subject,
      html,
    };
    if (params.to) msg.to = params.to;
    if (params.bcc && params.bcc.length) msg.bcc = params.bcc.map((email) => ({ email }));
    if (params.text) msg.text = params.text;
    await this.send(msg);
  }

  private async send(msg: any): Promise<void> {
    try {
      await sgMail.send(msg);
    } catch (e) {
      this.logger.error('SendGrid send failed', e?.toString());
    }
  }

  private get mail() {
    return this.config.get('mail');
  }

  /** POST /auth/reset-password — public/reset_password.html */
  async sendResetPassword(toEmail: string, plainPassword: string): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.publicDir, 'reset_password.html');
    const html = this.render(file, {
      EMAIL: toEmail,
      PASSWORD: plainPassword,
      URL: m.appUrl,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    await this.send({
      to: toEmail,
      bcc: [
        ...(m.bccEmail ? [{ email: m.bccEmail }] : []),
        { email: 'resetpwds@stayhopper.com' },
      ],
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: Reset Password',
      text: 'Password reset for your account, see details below:',
      html,
    });
  }

  /** administrators send-welcome-email — emails/welcome.html */
  async sendWelcome(toEmail: string, plainPassword: string): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.emailsDir, 'welcome.html');
    const html = this.render(file, {
      USERNAME: toEmail,
      PASSWORD: plainPassword,
      URL: m.extranetUrl,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    await this.send({
      to: toEmail,
      bcc: m.bccEmail ? [{ email: m.bccEmail }] : [],
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: Account has been created!',
      text: 'Congratulations! Your account has been created',
      html,
    });
  }

  private static readonly HOURS_KEY_WORDS: Record<string, string> = Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => {
      const suffix = i < 12 ? 'AM' : 'PM';
      let h12 = i % 12;
      if (h12 === 0) h12 = 12;
      return [`h${i}`, `${String(h12).padStart(2, '0')}:00 ${suffix}`];
    }),
  );

  private static readonly ROW_TEMPLATE = ` <tr>
      <td width="33%" align="center" class="suggested_rate align-center"><span class="f-fallback" {{MODIFIED_HOUR_STYLE}}>{{HOUR_TEXT}}</span></td>
      <td class="suggested_rate align-center" align="center" width="33%"><span class="f-fallback" {{MODIFIED_WEEKDAY_STYLE}}>{{WEEKDAY_RATE}} {{CURRENCY}} {{WEEKDAY_INCREMENTED_RATE}}</span></td>
      <td class="suggested_rate align-center" align="center" width="33%"><span class="f-fallback" {{MODIFIED_WEEKEND_STYLE}}>{{WEEKEND_RATE}} {{CURRENCY_WEEKEND}}  {{WEEKEND_INCREMENTED_RATE}}</span></td>
      </tr>`;

  /**
   * Builds a single {{ROWn}} snippet comparing a "high" band (suggested) against a
   * "base" band (current), flagging increases in red — mirrors the legacy loop body.
   */
  private buildRateRow(hourKey: string, highBand: any, baseBand: any, currency: string): string {
    let row = MailService.ROW_TEMPLATE;
    row = row.replace('{{CURRENCY}}', currency).replace('{{CURRENCY_WEEKEND}}', currency);
    row = row.replace('{{HOUR_TEXT}}', MailService.HOURS_KEY_WORDS[hourKey]);

    const wdHigh = highBand?.weekday?.hours?.[hourKey];
    const wdBase = baseBand?.weekday?.hours?.[hourKey];
    const weHigh = highBand?.weekend?.hours?.[hourKey];
    const weBase = baseBand?.weekend?.hours?.[hourKey];

    let modified = false;
    row = row.replace('{{WEEKDAY_RATE}}', String(wdHigh ?? ''));
    if (wdHigh > wdBase) {
      row = row.replace('{{MODIFIED_WEEKDAY_STYLE}}', ' style="color: red;"');
      row = row.replace(
        '{{WEEKDAY_INCREMENTED_RATE}}',
        `<span style="color: green;font-size: 12px;">(+${wdHigh - wdBase} ${currency})</span>`,
      );
      modified = true;
    } else {
      row = row.replace('{{MODIFIED_WEEKDAY_STYLE}}', '').replace('{{WEEKDAY_INCREMENTED_RATE}}', '');
    }

    row = row.replace('{{WEEKEND_RATE}}', String(weHigh ?? ''));
    if (weHigh > weBase) {
      row = row.replace('{{MODIFIED_WEEKEND_STYLE}}', ' style="color: red;"');
      row = row.replace(
        '{{WEEKEND_INCREMENTED_RATE}}',
        `<span style="color: green;font-size: 12px;">(+${weHigh - weBase} ${currency})</span>`,
      );
      modified = true;
    } else {
      row = row.replace('{{MODIFIED_WEEKEND_STYLE}}', '').replace('{{WEEKEND_INCREMENTED_RATE}}', '');
    }

    row = row.replace('{{MODIFIED_HOUR_STYLE}}', modified ? ' style="color: red;"' : '');
    return row;
  }

  /**
   * Rate-suggestion request notification (rooms modifyRate, when isExistPriceSuggestion=true).
   * `high` = the suggested_rates band, `base` = the submitted rate band.
   */
  async sendRateSuggestionRequest(params: {
    hotelName: string;
    extranetUrl: string;
    currency: string;
    high: any;
    base: any;
  }): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.publicDir, 'rate_suggestion_request.html');
    let html = this.render(file, {
      HOTEL_NAME: params.hotelName,
      EXTRANET_URL: params.extranetUrl,
      WEEKDAY_FULLDAY_RATE: String(params.high?.weekday?.fullDay ?? ''),
      WEEKEND_FULLDAY_RATE: String(params.high?.weekend?.fullDay ?? ''),
      CURRENCY: params.currency,
      CURRENCY_WEEKEND: params.currency,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    for (let i = 0; i <= 23; i++) {
      html = html.replace(`{{ROW${i}}}`, this.buildRateRow(`h${i}`, params.high, params.base, params.currency));
    }
    await this.send({
      to: m.contactusEmail,
      bcc: m.bccEmail ? [{ email: m.bccEmail }] : [],
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: New rate suggestion request!',
      html,
    });
  }

  /**
   * Rate-suggestion rejected notification (rooms modifyRate, when a suggestion is cleared).
   * `high` = previously-suggested band, `base` = current rate band.
   */
  async sendRateSuggestionRejected(params: {
    toEmail: string;
    hotelName: string;
    currency: string;
    high: any;
    base: any;
    reason?: string;
  }): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.publicDir, 'rate_suggestion_request_rejected.html');
    let html = this.render(file, {
      HOTEL_NAME: params.hotelName,
      WEEKDAY_FULLDAY_RATE: String(params.high?.weekday?.fullDay ?? ''),
      WEEKEND_FULLDAY_RATE: String(params.high?.weekend?.fullDay ?? ''),
      CURRENCY: params.currency,
      CURRENCY_WEEKEND: params.currency,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    for (let i = 0; i <= 23; i++) {
      html = html.replace(`{{ROW${i}}}`, this.buildRateRow(`h${i}`, params.high, params.base, params.currency));
    }
    const reasonHtml = params.reason
      ? ` <p><span style=" font-weight: bold;">Reasons:</span></p>
      <p style="font-family: Helvetica, Arial, sans-serif;font-size: 16px;line-height: 23px;color: #8C8FB3;mso-line-height-rule: exactly;display: block;margin-top: 0;margin-bottom: 16px;">${params.reason}</p>`
      : '';
    html = html.replace('{{REASON_SECTION}}', reasonHtml);
    await this.send({
      to: params.toEmail,
      bcc: m.bccEmail ? [{ email: m.bccEmail }] : [],
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: Rejected your rate suggestion!',
      html,
    });
  }

  /**
   * Rate-suggestion accepted notification (suggested-rates acceptSuggestedRate).
   * `high` = accepted suggested_rates band, `base` = the previous rate band.
   */
  async sendRateSuggestionAccepted(params: {
    toEmail: string;
    hotelName: string;
    extranetUrl: string;
    currency: string;
    high: any;
    base: any;
  }): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.publicDir, 'rate_suggestion_request_accepted.html');
    let html = this.render(file, {
      HOTEL_NAME: params.hotelName,
      EXTRANET_URL: params.extranetUrl,
      WEEKDAY_FULLDAY_RATE: String(params.high?.weekday?.fullDay ?? ''),
      WEEKEND_FULLDAY_RATE: String(params.high?.weekend?.fullDay ?? ''),
      CURRENCY: params.currency,
      CURRENCY_WEEKEND: params.currency,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    for (let i = 0; i <= 23; i++) {
      html = html.replace(`{{ROW${i}}}`, this.buildRateRow(`h${i}`, params.high, params.base, params.currency));
    }
    await this.send({
      to: params.toEmail,
      bcc: m.bccEmail ? [{ email: m.bccEmail }] : [],
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: Approved your rate suggestion!',
      html,
    });
  }

  // ---------------------------------------------------------------------------
  // audit A8: payment capture/return emails, ported from v2
  // controllers/api/v2/email.js + emailHotel.js(.js). Replacement maps are computed
  // by PaymentsService; these methods own template/subject/recipient wiring only.
  // ---------------------------------------------------------------------------

  /** audit A8: v2 capturedPaymentEmail — guest confirmation (public/booking_confirmation.html). */
  async sendCapturedPaymentEmail(toEmail: string, replacements: Record<string, string>): Promise<void> {
    const m = this.mail;
    await this.sendTemplated({
      template: 'booking_confirmation.html',
      replacements,
      to: toEmail,
      // v2 active line: bcc website_admin_bcc_email only.
      // TODO(⚠️ PRODUCT): v2 had `b2cbookings@stayhopper.com` bcc commented out ("TESTING") —
      // confirm whether to re-enable it for production.
      bcc: m.bccEmail ? [m.bccEmail] : [],
      subject: ' Your Stayhopper Booking has been confirmed! ',
      text: 'Stayhopper booking Almost has been confirmed!',
    });
  }

  /** audit A8: v2 capturedHotelEmail — hotel new-booking notice (public/order_hotel_captured.html). */
  async sendCapturedHotelEmail(
    toEmail: string,
    secondaryBcc: string[],
    replacements: Record<string, string>,
  ): Promise<void> {
    const m = this.mail;
    await this.sendTemplated({
      template: 'order_hotel_captured.html',
      replacements,
      to: toEmail,
      bcc: [
        ...(m.bccEmail ? [m.bccEmail] : []),
        'hotelbookings@stayhopper.com',
        ...secondaryBcc,
      ],
      subject: 'Stayhopper: New Booking',
      text: 'Stayhopper New Hotel Booking',
    });
  }

  /** audit A8: v2 cancelledPaymentEmail — guest cancellation (public/booking_cancelled.html). */
  async sendCancelledPaymentEmail(toEmail: string, replacements: Record<string, string>): Promise<void> {
    const m = this.mail;
    await this.sendTemplated({
      template: 'booking_cancelled.html',
      replacements,
      to: toEmail,
      bcc: m.bccEmail ? [m.bccEmail] : [],
      subject: ' Your Stayhopper Booking has been Cancelled! ',
      text: 'Stayhopper booking has been Cancelled!',
    });
  }

  /**
   * audit A8: v2 cancelledHotelEmail — hotel cancellation (public/order_cancelled_hotel.html).
   * NOTE(⚠️ PRODUCT): v2's active `to:` line sent this to the GUEST email, not the hotel
   * (likely a copy-paste bug). Parity preserved — caller passes the v2 recipient; confirm
   * whether it should go to property.primaryReservationEmail instead.
   */
  async sendCancelledHotelEmail(toEmail: string, replacements: Record<string, string>): Promise<void> {
    const m = this.mail;
    await this.sendTemplated({
      template: 'order_cancelled_hotel.html',
      replacements,
      to: toEmail,
      bcc: m.bccEmail ? [m.bccEmail] : [],
      subject: ' Your Stayhopper Booking has been Cancelled! ',
      text: 'Stayhopper booking has been Cancelled!',
    });
  }

  /** administrators onboarding — emails/activate-hotel-admin.html */
  async sendActivationCode(toEmail: string, activationCode: string): Promise<void> {
    const m = this.mail;
    const file = path.join(process.cwd(), m.emailsDir, 'activate-hotel-admin.html');
    const html = this.render(file, {
      ACTIVATION_CODE: activationCode,
      CURRENT_YEAR: String(new Date().getFullYear()),
    });
    await this.send({
      to: toEmail,
      from: { email: m.fromEmail, name: m.fromName },
      subject: 'STAYHOPPER: Activation Code',
      text: 'Use this activation code to proceed',
      html,
    });
  }
}
