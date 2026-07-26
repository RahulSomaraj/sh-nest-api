import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One entry of the `errors` array Mailchimp returns from a batch list POST. */
export interface MailchimpMemberError {
  email_address: string;
  error: string;
  error_code?: string;
}

export interface MailchimpBatchResult {
  new_members: unknown[];
  updated_members: unknown[];
  errors: MailchimpMemberError[];
  total_created: number;
  total_updated: number;
  error_count: number;
}

/**
 * Replaces the legacy `mailchimp-api-v3` client (`new Mailchimp(config.mailchimp_api_key)`
 * then `.post('/lists/' + listId, { members: [...] })`) with a `fetch` call against the
 * same Marketing API v3 endpoint — the response shape the callers branch on
 * (`result.errors[0].error` / `.email_address`) is Mailchimp's, so it is unchanged.
 *
 * The datacenter prefix is taken from the key suffix (`<key>-us19` → `us19`), exactly
 * as the old client did.
 */
@Injectable()
export class MailchimpService {
  private readonly logger = new Logger(MailchimpService.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('mailchimp.apiKey') || '';
  }

  private get baseUrl(): string | null {
    const dc = this.apiKey.split('-')[1];
    if (!dc) return null;
    return `https://${dc}.api.mailchimp.com/3.0`;
  }

  /**
   * Subscribe one address to a list. Resolves with the raw batch result so callers can
   * reproduce the legacy status/message branching; resolves to `null` when Mailchimp is
   * not configured (no key / no list id) so the surrounding flow still succeeds — legacy
   * swallowed these failures in a `.catch(console.log)` too.
   */
  async subscribe(
    listId: string,
    emailAddress: string,
  ): Promise<MailchimpBatchResult | null> {
    const base = this.baseUrl;
    if (!base || !listId) {
      this.logger.warn(
        `Mailchimp not configured (key/list missing) — skipping subscribe for ${emailAddress}`,
      );
      return null;
    }

    const response = await fetch(`${base}/lists/${listId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`anystring:${this.apiKey}`).toString('base64')}`,
      },
      body: JSON.stringify({
        members: [{ email_address: emailAddress, status: 'subscribed' }],
      }),
    });

    const body = (await response.json().catch(() => ({}))) as Partial<MailchimpBatchResult>;
    if (!response.ok && !Array.isArray(body.errors)) {
      // A transport/auth-level failure — surface it the way the legacy `.catch` branch did.
      throw new Error(
        `Mailchimp responded ${response.status}: ${JSON.stringify(body)}`,
      );
    }
    return {
      new_members: body.new_members ?? [],
      updated_members: body.updated_members ?? [],
      errors: body.errors ?? [],
      total_created: body.total_created ?? 0,
      total_updated: body.total_updated ?? 0,
      error_count: body.error_count ?? 0,
    };
  }

  /**
   * Fire-and-forget subscribe used by the signup flows, where legacy logged the outcome
   * and never failed the request.
   */
  async subscribeQuietly(listId: string, emailAddress: string): Promise<void> {
    try {
      const result = await this.subscribe(listId, emailAddress);
      if (result?.errors?.length) {
        this.logger.warn(
          `Mailchimp subscribe returned errors for ${emailAddress}: ${JSON.stringify(result.errors)}`,
        );
      }
    } catch (e) {
      this.logger.warn(`Mailchimp subscribe failed for ${emailAddress}: ${e}`);
    }
  }

  /** Resolve the list id for a signup device_type, mirroring the legacy branching. */
  listIdForDeviceType(deviceType: string | undefined): string {
    if (deviceType === 'ios') return this.config.get<string>('mailchimp.iosId') || '';
    // Legacy explicitly commented out the "web" case, leaving it with an empty list id.
    if (deviceType === 'web') return '';
    return this.config.get<string>('mailchimp.androidId') || '';
  }
}
