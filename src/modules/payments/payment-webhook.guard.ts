import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * audit C-1: authenticate the payment capture/return endpoints.
 *
 * These are gateway return URLs, so they can't carry a JWT — instead the caller must
 * present an HMAC signature over `${timestamp}.${bookingId}` using a shared secret
 * (PAYMENT_WEBHOOK_SECRET), plus a recent timestamp to prevent replay.
 *
 *   x-sh-timestamp: <unix seconds>
 *   x-sh-signature: hex( HMAC-SHA256(secret, `${timestamp}.${bookingId}`) )
 *
 * Rollout safety: if PAYMENT_WEBHOOK_SECRET is NOT configured, the guard logs a loud
 * warning and allows the request (so existing deployments don't break the moment this
 * ships). Set the secret and have the gateway/return-URL builder sign the request to
 * enforce verification. Once every caller signs, make the secret mandatory.
 */
@Injectable()
export class PaymentWebhookGuard implements CanActivate {
  private readonly logger = new Logger(PaymentWebhookGuard.name);
  private static readonly MAX_SKEW_SECONDS = 300; // 5 minutes

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('paymentWebhookSecret');
    const req: any = context.switchToHttp().getRequest();

    if (!secret) {
      this.logger.warn(
        `PAYMENT_WEBHOOK_SECRET not set — ${req.method} ${req.url} is UNVERIFIED. ` +
          'Configure it and sign gateway return URLs to secure payment endpoints.',
      );
      return true;
    }

    const signature = req.headers['x-sh-signature'];
    const timestamp = req.headers['x-sh-timestamp'];
    const bookingId = req.params?.bookingId ?? '';

    if (typeof signature !== 'string' || typeof timestamp !== 'string') {
      throw new UnauthorizedException('Missing payment signature');
    }

    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) {
      throw new UnauthorizedException('Invalid payment timestamp');
    }
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skew > PaymentWebhookGuard.MAX_SKEW_SECONDS) {
      throw new UnauthorizedException('Payment signature expired');
    }

    const expected = createHmac('sha256', secret)
      .update(`${ts}.${bookingId}`)
      .digest('hex');

    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid payment signature');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
