import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import moment from 'moment';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { MailModule } from '../../common/mail/mail.module';
import { MailService } from '../../common/mail/mail.service';
import { PaymentWebhookGuard } from './payment-webhook.guard';

/**
 * Port of capturePayment.js / returnPayment.js -> /admin/v2/capture/:bookingId and
 * /admin/v2/return/:bookingId. Core payment state transitions + external payment-container
 * calls are ported. audit A8: the guest/hotel confirmation & cancellation emails from
 * controllers/api/v2/email.js + emailHotel.js(.js) are now ported into MailService
 * (sendCaptured* / sendCancelled* helpers) and fired after the container /capture/ and /return/ calls.
 * Legacy routes had no auth guard (also used as gateway return URLs); preserved here.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('invoices') private readonly invoiceModel: Model<any>,
    @InjectModel('rooms') private readonly roomModel: Model<any>,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // audit A8: guest/hotel confirmation & cancellation emails, ported from v2
  // capturePayment.js / returnPayment.js + controllers/api/v2/email.js / emailHotel.js(.js).
  // ---------------------------------------------------------------------------

  private static readonly LEGACY_DATE_IN = 'ddd MMM DD YYYY HH:mm:ss [GMT]Z';
  private static readonly LEGACY_DATE_OUT = 'dddd DD-MM-YYYY | hh:mm A';

  /** Tokens shared by all four A8 emails (v2 route-body computations). */
  private async buildBookingEmailTokens(ub: any) {
    const property = ub.property;
    const rooms: any[] = ub.room || [];

    let totalRooms = 0;
    for (const r of rooms) totalRooms += +r.number || 0;
    let NO_OF_GUESTS = `${totalRooms} room, `;
    if (ub.no_of_adults) NO_OF_GUESTS += `${ub.no_of_adults} adults `;
    if (ub.no_of_children) NO_OF_GUESTS += `${ub.no_of_children} child`;

    // audit N+1: resolve all room types in ONE query instead of findOne() per room.
    const roomIds = rooms.map((r: any) => r.room?._id ?? r.room).filter(Boolean);
    const typeOfRooms: string[] = [];
    if (roomIds.length) {
      const roomDocs: any[] = await this.roomModel
        .find({ _id: { $in: roomIds } })
        .populate('room_type');
      const byId = new Map(roomDocs.map((rd: any) => [String(rd._id), rd]));
      for (const r of rooms) {
        const room: any = byId.get(String(r.room?._id ?? r.room));
        if (room?.room_type?.name) typeOfRooms.push(room.room_type.name);
      }
    }

    return {
      NAME: ub.guestinfo?.first_name ?? '',
      PROPERTY_NAME: property?.name ?? '',
      HEADING_PROPERTY_NAME: property?.name ?? '',
      BOOKING_TYPE: ub.bookingType
        ? ub.bookingType.charAt(0).toUpperCase() + ub.bookingType.substring(1)
        : '',
      NO_OF_GUESTS,
      TYPE_OF_ROOM: typeOfRooms.join(', '),
      STAY_DURATION: String(ub.stayDuration ?? ''),
      ORDER_NO: String(ub.book_id ?? ''),
      CHECKIN_DATE: moment(ub.date_checkin, PaymentsService.LEGACY_DATE_IN).format(PaymentsService.LEGACY_DATE_OUT),
      CHECKOUT_DATE: moment(ub.date_checkout, PaymentsService.LEGACY_DATE_IN).format(PaymentsService.LEGACY_DATE_OUT),
      PAYMENT_DATE: moment(ub.date_booked, PaymentsService.LEGACY_DATE_IN).format(PaymentsService.LEGACY_DATE_OUT),
      CURRENT_YEAR: String(new Date().getFullYear()),
    };
  }

  /** v2 capturePayment.js: guest confirmation + hotel new-booking emails. */
  private async sendCaptureEmails(ub: any, transactionId?: string) {
    try {
      const property = ub.property;
      const cur = ub.currencyCode;
      const base = await this.buildBookingEmailTokens(ub);
      const TRANSACTION_REFERENCE = transactionId || ub.charge_uid || '';

      const discountAmount = +ub.bookingFee * (ub.discount ? parseInt(ub.discount) / 100 : 0);
      const TOTAL_PRICE = +ub.total_amt - (+ub.bookingFee - discountAmount);
      const BALANCE_PRICE = +TOTAL_PRICE - +ub.paymentAmt;
      const TRANSACTION_AMOUNT = +ub.paymentAmt;

      // VATS breakdown — v2 ran two passes (display strings from total_amt, then raw
      // numbers from hotelAmt) into the same array; preserved verbatim.
      const taxesBreakdown: string[] = [];
      const tourism: number[] = [];
      if (property?.charges?.length) {
        property.charges.forEach((c: any) => {
          const chargeValue =
            c.chargeType === 'percentage'
              ? `@ ${c.value}% (${cur} ${parseFloat(parseFloat(String(ub.total_amt * (c.value / 100))).toFixed(2))} )`
              : `(${cur} ${c.value})`;
          if (c.name !== 'Tourism Fee') taxesBreakdown.push(`${c.name} ${chargeValue}`);
          else tourism.push(parseFloat(c.value.toFixed(2)));
        });
        property.charges.forEach((c: any) => {
          const chargeValue =
            c.chargeType === 'percentage' ? parseFloat(String(ub.hotelAmt * (c.value / 100))).toFixed(2) : c.value;
          if (c.name !== 'Tourism Fee') taxesBreakdown.push(`${c.name} ${chargeValue}`);
          else tourism.push(parseFloat(c.value.toFixed(2)));
        });
      }
      const VATS = `- ${taxesBreakdown.join(', ')} *`;
      const TOURISM_FEE = `${cur} ${tourism[0] ?? ''}`;

      // Guest confirmation (v2 capturedPaymentEmail). Note the v2 quirk: {{TOTAL_PRICE}}
      // in this template is filled with TRANSACTION_AMOUNT — preserved.
      await this.mailService.sendCapturedPaymentEmail(ub.guestinfo?.email, {
        ...base,
        TOURIMFEE: TOURISM_FEE,
        VATS,
        TRANSACTION_REFERENCE,
        TRANSACTION_AMOUNT: `${cur} ${TRANSACTION_AMOUNT}`,
        BALANCE_PRICE: `${cur} ${BALANCE_PRICE}`,
        TOTAL_PRICE: `${cur} ${TRANSACTION_AMOUNT}`,
        TRANSACTION_TIME: base.PAYMENT_DATE,
      });

      // Hotel notification (v2 capturedHotelEmail).
      // commissionHourly missing in v2 produced NaN in the email; defaulted to 0 here.
      const commission = +(property?.agreement?.commissionHourly ?? 0);
      let hotelTotalPrice = +ub.hotelAmt;
      if (property?.charges?.length) {
        property.charges.forEach((c: any) => {
          if (c.name !== 'Tourism Fee') hotelTotalPrice += (ub.hotelAmt / 100) * c.value;
        });
      }
      const HOTEL_PRICE = (+ub.hotelAmt + (commission / 100) * +ub.hotelAmt).toFixed(2);
      const COMMISSION_AMOUNT = ((commission / 100) * +ub.hotelAmt).toFixed(2);
      const HOTEL_VCC = (+hotelTotalPrice.toFixed(2)).toFixed(2);

      const secondaryBcc: string[] = (property?.secondaryReservationEmails || '')
        .split(',')
        .map((e: string) => e.trim())
        .filter(Boolean);

      await this.mailService.sendCapturedHotelEmail(property?.primaryReservationEmail, secondaryBcc, {
        ...base,
        TOURIMFEE: TOURISM_FEE,
        GUEST_FIRST_NAME: (ub.guestinfo?.first_name ?? '').toUpperCase(),
        PRINT_URL: `${this.config.get<string>('appUrl')}print/booking/${ub._id}`,
        ROOM_AND_TAXES: `${cur} ${(+ub.hotelAmt).toFixed(2)}`,
        VATS,
        TRANSACTION_REFERENCE,
        TRANSACTION_AMOUNT: `${cur} ${HOTEL_PRICE}`,
        BALANCE_PRICE: `${cur} ${BALANCE_PRICE}`,
        ROOM_AND_TAXES_AND_COMMISSION_AMOUNT: `${cur} ${HOTEL_PRICE}`,
        TRANSACTION_TIME: base.PAYMENT_DATE,
        COMMISSION_AMOUNT: `${cur} ${COMMISSION_AMOUNT}`,
        VCC_AMOUNT: `${cur} ${HOTEL_VCC}`,
      });
    } catch (e) {
      // Never let notification failures affect the money-movement response (v2 fired
      // these without awaiting/handling).
      this.logger.error('capture emails failed', (e as any)?.toString());
    }
  }

  /** v2 returnPayment.js: guest cancellation + hotel cancellation emails. */
  private async sendReturnEmails(ub: any) {
    try {
      const property = ub.property;
      const cur = ub.currencyCode;
      const base = await this.buildBookingEmailTokens(ub);
      const TRANSACTION_REFERENCE = ub.charge_uid || '';

      const discountAmount = +ub.bookingFee * (ub.discount ? parseInt(ub.discount) / 100 : 0);
      const TOTAL_PRICE = +ub.total_amt + (+ub.bookingFee - discountAmount); // v2 return used +, capture used -
      const BALANCE_PRICE = +TOTAL_PRICE - +ub.paymentAmt;
      const TRANSACTION_AMOUNT = +ub.paymentAmt;

      // v2's non-hourly VATS branch referenced an undefined variable and crashed the whole
      // route for charged non-hourly bookings; fixed to the evident intent (single pass).
      const taxesBreakdown: string[] = [];
      if (property?.charges?.length) {
        property.charges.forEach((c: any) => {
          const chargeValue =
            c.chargeType === 'percentage'
              ? `@ ${c.value}% (${cur} ${parseFloat(parseFloat(String(ub.total_amt * (c.value / 100))).toFixed(2))} )`
              : `(${cur} ${c.value})`;
          taxesBreakdown.push(`${c.name} ${chargeValue}`);
        });
      }
      const VATS = taxesBreakdown.length ? `- ${taxesBreakdown.join(', ')} *` : '';

      // Guest cancellation (v2 cancelledPaymentEmail). {{VCC_AMOUNT}} = raw transaction amount (v2 parity).
      await this.mailService.sendCancelledPaymentEmail(ub.guestinfo?.email, {
        ...base,
        VATS,
        VCC_AMOUNT: String(TRANSACTION_AMOUNT),
        TRANSACTION_REFERENCE,
        TRANSACTION_AMOUNT: `${cur} ${TRANSACTION_AMOUNT}`,
        BALANCE_PRICE: `${cur} ${BALANCE_PRICE}`,
        TOTAL_PRICE: `${cur} ${TOTAL_PRICE}`,
        TRANSACTION_TIME: base.PAYMENT_DATE,
      });

      // Hotel cancellation (v2 cancelledHotelEmail) — v2 sent this to the GUEST email
      // (see MailService note); recipient parity preserved pending product decision.
      const commission = +(property?.agreement?.commissionHourly ?? 0);
      let hotelTotalPrice = +ub.hotelAmt;
      if (property?.charges?.length) {
        property.charges.forEach((c: any) => {
          if (c.name !== 'Tourism Fee') hotelTotalPrice += (ub.hotelAmt / 100) * c.value;
        });
      }
      const HOTEL_TOTAL_PRICE = hotelTotalPrice.toFixed(2);
      const HOTEL_PRICE = (+ub.hotelAmt + (commission / 100) * +ub.hotelAmt).toFixed(2);
      const COMMISSION_AMOUNT = ((commission / 100) * +ub.hotelAmt).toFixed(2);
      const REJECTION_AMOUNT = (+HOTEL_PRICE - +COMMISSION_AMOUNT).toFixed(2);

      await this.mailService.sendCancelledHotelEmail(ub.guestinfo?.email, {
        ...base,
        VATS,
        ROOM_AND_TAXES: String(+(+ub.hotelAmt).toFixed(2)),
        VCC_AMOUNT: `${cur} ${HOTEL_TOTAL_PRICE}`,
        ROOM_AND_TAXES_AND_COMMISSION_AMOUNT: `${cur} ${HOTEL_TOTAL_PRICE}`,
        TRANSACTION_REFERENCE,
        TRANSACTION_AMOUNT: `${cur} ${HOTEL_TOTAL_PRICE}`,
        BALANCE_PRICE: `${cur} ${BALANCE_PRICE}`,
        TOTAL_PRICE: `${cur} ${REJECTION_AMOUNT}`,
        TRANSACTION_TIME: base.PAYMENT_DATE,
      });
    } catch (e) {
      this.logger.error('return emails failed', (e as any)?.toString());
    }
  }

  // audit C-5: never call the payment container without a timeout — a hung PSP would
  // otherwise pin a connection/event-loop slot indefinitely. Returns { ok, data }.
  private async containerPost(
    pathname: string,
    body: any,
  ): Promise<{ ok: boolean; data: any }> {
    const base = this.config.get<string>('paymentContainerUrl');
    // No container configured → treat as skipped (ok) so the flow isn't blocked (legacy parity).
    if (!base) return { ok: true, data: null };
    try {
      const resp = await fetch(`${base}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, data };
    } catch (e) {
      this.logger.error(`payment container ${pathname} failed`, (e as any)?.toString());
      return { ok: false, data: null };
    }
  }

  private async handleHotelPayment(invoiceId: string, status: 'paid' | 'rejected') {
    if (!invoiceId) return { invalid: true };
    const invoice: any = await this.invoiceModel.findOne({ _id: invoiceId });
    if (!invoice) return { status: 0 };
    invoice.status = status;
    await invoice.save();
    const extranet = this.config.get<string>('extranetUrl');
    return { redirectUrl: `${extranet}app/invoices/${invoiceId}` };
  }

  async capture(bookingId: string, invoiceIdFromQuery?: string, transactionId?: string) {
    const ub: any = await this.userBookingModel
      .findOne({ _id: bookingId })
      .populate('property')
      .populate('room.room');
    if (!ub || ub.hotel_approved) return { status: 0 };
    if (ub.invoice_id) return this.handleHotelPayment(invoiceIdFromQuery, 'paid');

    // audit C-1/C-4: idempotent, atomic state transition. Only the first request that
    // flips hotel_approved proceeds; concurrent/replayed hits are no-ops (no double capture).
    const claim = await this.userBookingModel.updateOne(
      { _id: bookingId, hotel_approved: { $ne: 1 } },
      { $set: { paid: 1, hotel_approved: 1 } },
    );
    if (!((claim as any).modifiedCount ?? (claim as any).nModified)) {
      return { status: 0, alreadyProcessed: true };
    }

    // audit C-4: if the gateway capture call fails, don't leave the booking marked paid.
    const captured = await this.containerPost('/capture/', {
      amount: ub.paymentAmt,
      chargeId: ub.charge_uid,
    });
    if (!captured.ok) {
      // Roll the claim back so the operation can be safely retried.
      await this.userBookingModel.updateOne(
        { _id: bookingId },
        { $set: { paid: 0, hotel_approved: 0 } },
      );
      this.logger.error(`capture ${bookingId}: gateway /capture/ failed; rolled back`);
      return { status: 0, gatewayError: true };
    }

    // VCC amount = hotelAmt + non-tourism charges applied to hotelAmt
    let vccAmount = +ub.hotelAmt || 0;
    const property = ub.property;
    if (property?.charges?.length) {
      property.charges.forEach((c: any) => {
        const chargeValue =
          c.chargeType === 'percentage' ? parseFloat((ub.hotelAmt * (c.value / 100)).toFixed(2)) : c.value;
        if (c.name !== 'Tourism Fee') vccAmount += +chargeValue;
      });
    }

    // audit A8: guest + hotel confirmation emails (v2 capturedPaymentEmail/capturedHotelEmail).
    // Fired without await — v2 didn't block the gateway response on them either.
    void this.sendCaptureEmails(ub, transactionId);

    const vcc = await this.containerPost('/vcc/', {
      amount: vccAmount,
      email: process.env.KYCMAIL,
      verifyEmail: property?.primaryReservationEmail,
      bookingId: ub.book_id,
    });
    if (vcc.ok && vcc.data?.url) {
      await this.userBookingModel.updateOne({ _id: bookingId }, { $set: { vcc: vcc.data.url } });
      return { status: 1, url: vcc.data.url };
    }
    // Captured but VCC not issued — flag for reconciliation rather than silently dropping.
    await this.userBookingModel.updateOne(
      { _id: bookingId },
      { $set: { vcc_pending: true } },
    );
    this.logger.error(`capture ${bookingId}: captured but VCC not issued; flagged vcc_pending`);
    return { status: 0, vccPending: true };
  }

  async return(bookingId: string, invoiceIdFromQuery?: string) {
    const ub: any = await this.userBookingModel
      .findOne({ _id: bookingId })
      .populate('property')
      .populate('room.room');
    if (!ub || ub.hotel_cancelled || ub.hotel_approved) return { status: 0 };
    if (ub.invoice_id) return this.handleHotelPayment(invoiceIdFromQuery, 'rejected');

    // audit C-1/C-4: idempotent, atomic state transition (no double refund on replay).
    const claim = await this.userBookingModel.updateOne(
      { _id: bookingId, hotel_cancelled: { $ne: 1 }, hotel_approved: { $ne: 1 } },
      { $set: { paid: 0, hotel_cancelled: 1 } },
    );
    if (!((claim as any).modifiedCount ?? (claim as any).nModified)) {
      return { status: 0, alreadyProcessed: true };
    }

    const returned = await this.containerPost('/return/', {
      amount: ub.paymentAmt,
      chargeId: ub.charge_uid,
    });
    if (!returned.ok) {
      await this.userBookingModel.updateOne(
        { _id: bookingId },
        { $set: { hotel_cancelled: 0 } },
      );
      this.logger.error(`return ${bookingId}: gateway /return/ failed; rolled back`);
      return { status: 0, gatewayError: true };
    }

    // audit A8: guest + hotel cancellation emails (v2 cancelledPaymentEmail/cancelledHotelEmail).
    void this.sendReturnEmails(ub);

    return { status: 1 };
  }
}

// audit C-1: these are gateway return URLs (kept as GET for PSP compatibility) but are now
// HMAC-verified by PaymentWebhookGuard and rate-limited (10/min/IP) as defence-in-depth.
@Controller('capture')
@UseGuards(PaymentWebhookGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class CaptureController {
  constructor(private readonly service: PaymentsService) {}

  @Get(':bookingId')
  capture(
    @Param('bookingId') bookingId: string,
    @Query('invoice_id') invoiceId?: string,
    // audit A8: v2 used req.query.transactionId as TRANSACTION_REFERENCE in the emails.
    @Query('transactionId') transactionId?: string,
  ) {
    return this.service.capture(bookingId, invoiceId, transactionId);
  }
}

@Controller('return')
@UseGuards(PaymentWebhookGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ReturnController {
  constructor(private readonly service: PaymentsService) {}

  @Get(':bookingId')
  return(@Param('bookingId') bookingId: string, @Query('invoice_id') invoiceId?: string) {
    return this.service.return(bookingId, invoiceId);
  }
}

@Module({
  imports: [
    ReferenceModelsModule,
    MailModule, // audit A8: capture/return confirmation & cancellation emails
    MongooseModule.forFeature([{ name: 'invoices', schema: InvoiceSchema }]),
  ],
  controllers: [CaptureController, ReturnController],
  providers: [PaymentsService, PaymentWebhookGuard],
})
export class PaymentsModule {}
