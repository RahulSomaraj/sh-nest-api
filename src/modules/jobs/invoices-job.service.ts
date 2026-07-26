import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import moment from 'moment';
import { MailService } from '../../common/mail/mail.service';

/** A calendar month (or partial month) to bill for. */
interface MonthRange {
  start: Date;
  end: Date;
}

export interface GenerateInvoicesParams {
  /** `DD-MM-YYYY`. Present => legacy threw; kept so the contract is unchanged. */
  date?: string;
  /** `DD-MM-YYYY` — first month to bill. */
  from?: string;
  /** `DD-MM-YYYY` — last month to bill. */
  to?: string;
  disableEmailToProperty?: boolean;
}

/**
 * Port of the `string-hash` package (djb2-xor) used to derive the invoice code.
 * Reproduced exactly so invoice numbers stay stable across the cutover.
 */
function stringHash(str: string): number {
  let hash = 5381;
  let i = str.length;
  while (i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

/** Port of `utils/commonUtils.js#numberToFourDigits`. */
function numberToFourDigits(value: number): string {
  const s = String(value);
  if (s.length === 4) return s;
  if (s.length < 4) return '0'.repeat(4 - s.length) + s;
  return s.slice(0, 4);
}

/** `randomatic("0", n)` — n random decimal digits. */
function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

/**
 * C9 — monthly commission invoicing, ported from `stayhopper/cron-invoices.js`.
 *
 * MIGRATION.md scopes this to the **manual trigger** only: legacy's monthly
 * `cron.schedule("0 0 1 * *")` has its `generateInvoices` call commented out, so nothing
 * runs on a schedule today and porting one would start billing that isn't happening now.
 * The generator is exposed as `POST /admin/v2/invoices/generate` behind admin auth
 * instead (legacy exposed it as an UNAUTHENTICATED `GET /generate-invoice`).
 */
@Injectable()
export class InvoicesJobService {
  private readonly logger = new Logger(InvoicesJobService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @InjectModel('invoices') private readonly invoiceModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('completed_bookings')
    private readonly completedBookingModel: Model<any>,
  ) {}

  /**
   * Resolve the months to bill.
   *
   * With `from`/`to` the range is widened to whole months and clamped so an in-progress
   * month is never invoiced. With neither, it bills the previous month. Legacy threw for
   * a bare `date`, and that is preserved.
   */
  private resolveMonthRanges(params: GenerateInvoicesParams): MonthRange[] {
    let invoiceStartDate: Date;
    let invoiceEndDate: Date;

    if (params.from || params.to) {
      const startDate = params.from || new Date();
      const endDate = params.to || new Date();

      invoiceStartDate = moment(startDate, 'DD-MM-YYYY').startOf('month').toDate();

      let end = moment(endDate, 'DD-MM-YYYY').endOf('month');
      // Never invoice a month that hasn't finished — step back to the previous one.
      if (end.isAfter(moment(new Date()))) {
        end = end.subtract(1, 'months').endOf('month');
      }
      invoiceEndDate = end.toDate();

      if (moment(invoiceEndDate).isBefore(invoiceStartDate)) {
        throw new BadRequestException('Invalid end date');
      }
    } else if (!params.date) {
      invoiceStartDate = moment(new Date(), 'DD-MM-YYYY')
        .subtract(1, 'months')
        .startOf('month')
        .toDate();
      invoiceEndDate = moment(invoiceStartDate).endOf('month').toDate();
    } else {
      // Legacy parity: a bare `date` with no from/to falls through to an error.
      throw new BadRequestException('Something went wrong');
    }

    const monthRanges: MonthRange[] = [];
    const currentMonth = moment(invoiceStartDate).clone();
    const now = moment.utc(new Date());
    while (currentMonth.isBefore(invoiceEndDate)) {
      const startOfMonth = currentMonth.clone();
      let endOfMonth = currentMonth.clone().endOf('month');
      if (endOfMonth.isAfter(now)) endOfMonth = now;
      monthRanges.push({ start: startOfMonth.toDate(), end: endOfMonth.toDate() });
      currentMonth.add(1, 'months');
    }
    return monthRanges;
  }

  /**
   * Generate (or regenerate) invoices for the requested months.
   *
   * Any still-`pending` invoice for those months is deleted first, so re-running the
   * trigger replaces the previous draft rather than duplicating it. Paid/rejected
   * invoices are never touched.
   */
  async generateInvoices(params: GenerateInvoicesParams): Promise<{
    monthsBilled: string[];
    invoicesCreated: number;
  }> {
    const monthRanges = this.resolveMonthRanges(params);
    if (!monthRanges.length) {
      return { monthsBilled: [], invoicesCreated: 0 };
    }

    const invoiceForDates = monthRanges.map((m) =>
      moment(m.start).format('YYYY-MM-DD'),
    );
    const invoicesByMonthStrings = new Map<string, Array<Record<string, any>>>(
      monthRanges.map((m) => [moment(m.start).format('MMMM YYYY'), []]),
    );

    try {
      await this.invoiceModel
        .deleteMany({ status: 'pending', invoiceForDate: { $in: invoiceForDates } })
        .exec();
    } catch (e) {
      this.logger.error(`Could not clear pending invoices: ${e}`);
    }

    const properties = await this.propertyModel.find({}).select('_id').lean().exec();

    const invoicesByPropertyId = new Map<string, Array<Record<string, any>>>();
    let invoicesCreated = 0;

    for (const property of properties) {
      const propertyInvoices = await this.generateInvoiceForProperty(
        property._id,
        monthRanges,
      );
      if (!propertyInvoices.length) continue;

      invoicesCreated += propertyInvoices.length;
      invoicesByPropertyId.set(String(property._id), propertyInvoices);
      for (const invoice of propertyInvoices) {
        const key = invoice.invoiceForMonthString;
        invoicesByMonthStrings.set(key, [
          ...(invoicesByMonthStrings.get(key) ?? []),
          invoice,
        ]);
      }
    }

    if (!invoicesCreated) {
      this.logger.log('Invoice generation produced no invoices');
      return { monthsBilled: [...invoicesByMonthStrings.keys()], invoicesCreated: 0 };
    }

    // Months with nothing to bill don't get an admin summary.
    for (const [key, value] of invoicesByMonthStrings) {
      if (!value.length) invoicesByMonthStrings.delete(key);
    }
    await this.sendCombinedEmailToAdmin(invoicesByMonthStrings);

    if (!params.disableEmailToProperty) {
      for (const propertyInvoices of invoicesByPropertyId.values()) {
        for (const invoice of propertyInvoices) {
          await this.sendInvoiceToProperty(invoice);
        }
      }
    }

    this.logger.log(
      `Generated ${invoicesCreated} invoice(s) across ${invoicesByMonthStrings.size} month(s)`,
    );
    return { monthsBilled: [...invoicesByMonthStrings.keys()], invoicesCreated };
  }

  /**
   * Bill one property for each month in the range.
   *
   * The amount is what the property owes StayHopper (commission on completed bookings)
   * minus what StayHopper owes the property (the full room rate on monthly bookings,
   * which is collected on their behalf). A zero balance produces no invoice.
   */
  private async generateInvoiceForProperty(
    propertyId: unknown,
    monthRanges: MonthRange[],
  ): Promise<Array<Record<string, any>>> {
    const invoiceGenerationDateMoment = moment.utc(new Date());
    const property = await this.propertyModel
      .findOne({ _id: propertyId })
      .populate([{ path: 'currency' }, { path: 'payment.country' }])
      .exec();
    if (!property) {
      this.logger.warn(`Property ${String(propertyId)} not found; skipping invoice`);
      return [];
    }

    const invoiceList: Array<Record<string, any>> = [];

    for (const monthData of monthRanges) {
      const startDateMoment = moment(monthData.start);
      const endDateMoment = moment(monthData.end);

      let amountFromProperty = 0;
      let amountToProperty = 0;
      let totalBookingsCount = 0;
      let completedBookingsIds: unknown[] = [];

      const cbBookingTypes: Array<{
        bookingType: string;
        ids: unknown[];
        total_amt: number;
      }> = await this.completedBookingModel
        .aggregate([
          {
            $match: {
              'propertyInfo.id': property._id,
              paid: true,
              date_checkout: {
                $gte: startDateMoment.toDate(),
                $lt: endDateMoment.toDate(),
              },
              // No-shows and cancellations are not billable.
              nowshow_approval: { $ne: 1 },
              cancel_approval: { $ne: 1 },
            },
          },
          {
            $group: {
              _id: '$bookingType',
              bookingType: { $first: '$bookingType' },
              ids: { $push: '$_id' },
              total_amt: { $sum: '$total_amt' },
            },
          },
        ])
        .exec();

      // The property's own agreement overrides the platform default commission.
      const commission = { ...this.config.get<Record<string, number>>('commission') };
      if (property.agreement?.commissionHourly) {
        commission.hourly = property.agreement.commissionHourly;
      }
      if (property.agreement?.commissionMonthly) {
        commission.monthly = property.agreement.commissionMonthly;
      }

      for (const cbBookingType of cbBookingTypes) {
        completedBookingsIds = completedBookingsIds.concat(cbBookingType.ids);

        if (commission[cbBookingType.bookingType]) {
          amountFromProperty +=
            cbBookingType.total_amt * (commission[cbBookingType.bookingType] / 100);
        }

        // Hourly: the guest paid the hotel directly, so nothing is owed back.
        // Monthly: StayHopper collected the whole stay and owes it to the property.
        if (cbBookingType.bookingType === 'monthly') {
          amountToProperty += cbBookingType.total_amt;
        }
        totalBookingsCount += cbBookingType.ids.length;
      }

      amountFromProperty = parseFloat(amountFromProperty.toFixed(2));
      amountToProperty = parseFloat(amountToProperty.toFixed(2));
      const amount = parseFloat((amountFromProperty - amountToProperty).toFixed(2));
      if (!amount) continue;

      const invCode =
        stringHash(String(property._id)).toString().slice(0, 6) +
        numberToFourDigits(totalBookingsCount);

      // Unique per year-month + property; collide and a random block is inserted.
      let invoiceNo = ['SHINV', startDateMoment.format('YYYY-MM'), invCode].join('-');
      const isExistInvoiceNumber = await this.invoiceModel
        .findOne({ invoiceNo })
        .lean()
        .exec();
      if (isExistInvoiceNumber) {
        invoiceNo = [
          'SHINV',
          startDateMoment.format('YYYY-MM'),
          randomDigits(3),
          invCode,
        ].join('-');
      }

      const invoice = await this.invoiceModel.create({
        invoiceNo,
        issueDate: invoiceGenerationDateMoment.toDate(),
        invoiceForDate: startDateMoment.format('YYYY-MM-DD'),
        invoiceForMonthString: startDateMoment.format('MMMM YYYY'),
        status: 'pending',
        invoiceSentToProperty: false,
        completedBookings: completedBookingsIds,
        commissionHourly: commission.hourly,
        commissionMonthly: commission.monthly,
        paymentUrl: '',
        property: property._id,
        currency: property.currency,
        amountFromProperty,
        amountToProperty,
        amount,
        totalBookingsCount,
      });

      await this.invoiceModel.populate(invoice, {
        path: 'property currency completedBookings',
      });
      invoiceList.push(invoice);
    }

    return invoiceList;
  }

  /** One summary mail per billed month to the invoices mailbox. */
  private async sendCombinedEmailToAdmin(
    invoicesByMonthStrings: Map<string, Array<Record<string, any>>>,
  ): Promise<void> {
    const invoicesUrl = `${this.config.get<string>('extranetUrl')}app/invoices`;

    for (const [invoiceMonthYear, invoices] of invoicesByMonthStrings) {
      const propertiesCountStr =
        invoices.length === 1 ? `${invoices.length} property` : `${invoices.length} properties`;
      await this.mail.sendTemplated({
        template: 'invoice-emails/invoices-combined-admin.html',
        replacements: {
          INVOICE_MONTH: invoiceMonthYear,
          INVOICES_URL: invoicesUrl,
          PROPERTIES_COUNT_STR: propertiesCountStr,
          CURRENT_YEAR: String(new Date().getFullYear()),
        },
        // MIGRATION.md 2g#3: legacy hardcoded `to: "stayhopper@gmail.com"` — routed to
        // the configured invoices mailbox instead.
        to: this.config.get<string>('mail.invoiceEmail'),
        bcc: [this.config.get<string>('mail.bccEmail')].filter(Boolean),
        subject: `STAYHOPPER: ${invoiceMonthYear} Invoice sent to ${propertiesCountStr}`,
        text: 'Invoices generated',
      });
    }
  }

  /** The property's own copy, plus the flags recording that it was sent. */
  private async sendInvoiceToProperty(invoice: Record<string, any>): Promise<void> {
    const adminEmail = this.config.get<string>('mail.invoiceEmail');
    const propertyEmail = invoice.property?.contactinfo?.email;
    if (!propertyEmail) {
      this.logger.warn(
        `Invoice ${invoice.invoiceNo}: property has no contact email; not sent`,
      );
      return;
    }

    await this.mail.sendTemplated({
      template: 'invoice-emails/invoice-property.html',
      replacements: {
        INVOICE_MONTH: invoice.invoiceForMonthString,
        PROPERTY_NAME: invoice.property.name,
        PAYMENT_URL: invoice.paymentUrl,
        CURRENCY: invoice.currency?.code ?? '',
        PAYMENT_AMOUNT: String(invoice.amount),
        INVOICE_URL: `${this.config.get<string>('extranetUrl')}app/invoices/${invoice._id}`,
        CURRENT_YEAR: String(new Date().getFullYear()),
      },
      // MIGRATION.md 2g#3: legacy sent this to a hardcoded personal gmail
      // (`abdurasak2k@gmail.com`) with the real recipient commented out — so properties
      // are NOT receiving their invoices today. Routed to the property's own address.
      to: propertyEmail,
      bcc: [adminEmail].filter(Boolean),
      subject: `STAYHOPPER: Your ${invoice.invoiceForMonthString} invoice is available`,
      text: 'Your invoice is available',
    });

    await this.invoiceModel
      .updateOne(
        { _id: invoice._id },
        { $set: { invoiceSentToProperty: true, invoiceSentToPropertyDate: new Date() } },
      )
      .exec();
  }
}
