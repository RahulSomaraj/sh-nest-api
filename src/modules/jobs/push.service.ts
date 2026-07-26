import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/**
 * Firebase Cloud Messaging sender.
 *
 * MIGRATION.md phase 3: legacy used the `fcm-node` package against the FCM **legacy**
 * HTTP API with a committed server key. Google decommissioned that API, so those pushes
 * are almost certainly failing silently in production today. This uses FCM HTTP v1 with
 * a service-account JSON instead.
 *
 * Everything is a no-op unless `ENABLE_PUSH=true` and credentials resolve, so a
 * misconfigured environment degrades to "no pushes" rather than crashing a cron run.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectModel('notificationlogs')
    private readonly notificationLogModel: Model<any>,
  ) {}

  get enabled(): boolean {
    return !!this.config.get<boolean>('push.enabled');
  }

  private loadServiceAccount(): ServiceAccount | null {
    const inline = this.config.get<string>('push.serviceAccountJson');
    const path = this.config.get<string>('push.serviceAccountPath');
    try {
      if (inline) return JSON.parse(inline) as ServiceAccount;
      if (path) return JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
    } catch (e) {
      this.logger.error(`Could not read FCM service account: ${e}`);
    }
    return null;
  }

  /** Mint (and cache) an OAuth2 access token for the messaging scope. */
  private async getAccessToken(account: ServiceAccount): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt > now + 60) {
      return this.accessToken.value;
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64(header)}.${b64(claim)}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!response.ok) {
      this.logger.error(`FCM token request failed: ${response.status}`);
      return null;
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = {
      value: body.access_token,
      expiresAt: now + body.expires_in,
    };
    return body.access_token;
  }

  /**
   * Send one notification to a list of device tokens. FCM v1 has no multicast endpoint,
   * so tokens are sent individually; failures are logged and never thrown, matching the
   * fire-and-forget behaviour the cron jobs relied on.
   */
  async sendToTokens(
    tokens: string[],
    notification: { title: string; body: string },
    data?: Record<string, string>,
  ): Promise<void> {
    const deviceTokens = tokens.filter(Boolean);
    if (!this.enabled || !deviceTokens.length) return;

    const account = this.loadServiceAccount();
    if (!account) {
      this.logger.warn('ENABLE_PUSH is set but no FCM service account is configured');
      return;
    }
    const token = await this.getAccessToken(account);
    if (!token) return;

    const projectId = this.config.get<string>('push.projectId') || account.project_id;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    for (const deviceToken of deviceTokens) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: { token: deviceToken, notification, ...(data ? { data } : {}) },
          }),
        });
        if (!response.ok) {
          this.logger.warn(
            `FCM send failed for one device (${response.status}); continuing`,
          );
        }
      } catch (e) {
        this.logger.warn(`FCM send threw for one device: ${e}`);
      }
    }
  }

  /**
   * Record the attempt in `notificationlogs`, as the legacy senders did. Always runs,
   * even when pushes are disabled, so the log still shows what *would* have been sent.
   */
  private async log(
    deviceToken: string,
    type: string,
    bookingId: unknown,
  ): Promise<void> {
    try {
      await this.notificationLogModel.create({
        device_token: deviceToken,
        type,
        booking_id: bookingId,
      });
    } catch (e) {
      this.logger.warn(`Could not write notification log: ${e}`);
    }
  }

  /**
   * C3 — "your booking starts in 30 minutes" (legacy `send_fcm`).
   *
   * Legacy sent a slightly different payload per platform (iOS carried
   * `notification_id` inside the notification block, Android a `click_action`). FCM v1
   * moves both into platform-specific blocks, and the app reads `data.*` in either case,
   * so the data payload — which is what the client actually branches on — is identical.
   */
  async sendBookingReminder(
    recipients: Array<{
      device_token: string;
      device_type?: string;
      property_name: string;
      id: unknown;
      notification_id: unknown;
    }>,
  ): Promise<void> {
    for (const recipient of recipients) {
      await this.sendToTokens(
        [recipient.device_token],
        {
          title: 'Booking Notification',
          body: `Your booking at ${recipient.property_name} in 30 minutes.`,
        },
        {
          type: 'BOOK_NOTIFY',
          book_id: String(recipient.id),
          notification_id: String(recipient.notification_id),
        },
      );
      await this.log(recipient.device_token, 'BOOK_NOTIFY', recipient.id);
    }
  }

  /** C6 — "extend your stay?" (legacy `send_fcm_booking_extension`). */
  async sendBookingExtension(
    recipients: Array<{
      device_token: string;
      device_type?: string;
      id: unknown;
      notification_id: unknown;
    }>,
  ): Promise<void> {
    for (const recipient of recipients) {
      await this.sendToTokens(
        [recipient.device_token],
        {
          // Legacy titled the iOS variant "*Extend your stay?" (stray asterisk) and the
          // Android one "Re-Booking Notification". Unified on the intended copy.
          title: 'Extend your stay?',
          body: 'Your checkout is in 30 minutes. Do you want to extend?',
        },
        {
          type: 'REBOOKING',
          book_id: String(recipient.id),
          notification_id: String(recipient.notification_id),
        },
      );
      await this.log(recipient.device_token, 'REBOOKING', recipient.id);
    }
  }

  /**
   * C2 — "how was your stay?" (legacy `send_fcm_review`).
   * NOTE: legacy logged this one under type `BOOK_NOTIFY`, not `REVIEW` — kept, so the
   * existing log rows stay comparable.
   */
  async sendReviewRequest(params: {
    device_token: string;
    device_type?: string;
    property_name: string;
    property_id: unknown;
    book_id: unknown;
    notification_id: unknown;
  }): Promise<void> {
    await this.sendToTokens(
      [params.device_token],
      {
        title: 'Review property',
        body: `How was your stay at ${params.property_name}?`,
      },
      {
        type: 'REVIEW',
        book_id: String(params.book_id),
        property_name: params.property_name,
        property_id: String(params.property_id),
        notification_id: String(params.notification_id),
      },
    );
    await this.log(params.device_token, 'BOOK_NOTIFY', params.book_id);
  }
}
