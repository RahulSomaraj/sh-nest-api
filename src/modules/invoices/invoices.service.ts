import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import moment from 'moment';

const populations = [
  { path: 'property', populate: [{ path: 'contactinfo.country' }, { path: 'contactinfo.city' }] },
  { path: 'currency' },
  { path: 'userBookings' },
  { path: 'completedBookings' },
];

const has = (permissions: string[], p: string) =>
  permissions.indexOf('*') > -1 || permissions.indexOf(p) > -1;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel('invoices') private readonly invoiceModel: Model<any>,
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    private readonly config: ConfigService,
  ) {}

  private buildPages(basePath: string, limit: number, pageCount: number, currentPage: number) {
    const pages: { number: number; url: string }[] = [];
    const maxPages = 10;
    let start = Math.max(1, currentPage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });
    return pages;
  }

  private async prepareWhere(query: any, user: any, permissions: string[]) {
    const hasAll = has(permissions, 'LIST_ALL_INVOICES');
    const hasOwn = has(permissions, 'LIST_OWN_INVOICES');
    const where: any = {};
    if (hasOwn && !hasAll) {
      const props = await this.propertyModel
        .find({ $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }] })
        .select('_id')
        .lean();
      where.$and = where.$and || [];
      where.$and.push({
        $or: [{ administrator: user._id }, { property: { $in: props.map((p: any) => p._id) } }],
      });
    }
    if (query.property) where.property = query.property;
    if (query.date) where.invoiceForDate = moment(new Date(query.date)).startOf('month').format('YYYY-MM-DD');
    if (query.status) where.status = query.status;
    return where;
  }

  async list(query: any, user: any, permissions: string[], basePath = '/admin/v2/invoices') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;
    const where = await this.prepareWhere(query, user, permissions);
    const hasAll = has(permissions, 'LIST_ALL_INVOICES');

    const isPropertySort = query.orderBy === 'property';
    const isAsc = query.order === 'asc';

    let list: any[];
    if (isPropertySort) {
      let all = await this.invoiceModel.find(where).populate(populations).lean().exec();
      all.sort((a: any, b: any) => {
        const na = (a.property?.name || '').trim().toLowerCase();
        const nb = (b.property?.name || '').trim().toLowerCase();
        return na < nb ? (isAsc ? -1 : 1) : na > nb ? (isAsc ? 1 : -1) : 0;
      });
      list = all.slice(skip, skip + limit);
    } else {
      let sort: any = { _id: 1 };
      if (query.order && query.orderBy) {
        sort = {};
        sort[query.orderBy] = isAsc ? 1 : -1;
      }
      list = await this.invoiceModel.find(where).sort(sort).populate(populations).skip(skip).limit(limit).lean().exec();
    }

    const [properties, itemCount] = await Promise.all([
      hasAll ? this.propertyModel.find({}).sort({ name: 1 }).lean() : Promise.resolve([]),
      this.invoiceModel.countDocuments(where),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    return {
      list,
      properties,
      itemCount,
      pageCount,
      pages: this.buildPages(basePath, limit, pageCount, activePage),
      active_page: activePage,
    };
  }

  async single(id: string, user: any, permissions: string[]) {
    const resource: any = await this.invoiceModel.findOne({ _id: id }).populate(populations).lean().exec();
    if (!resource) return { notFound: true };

    const hasAll = has(permissions, 'LIST_ALL_INVOICES');
    const hasOwn = has(permissions, 'LIST_OWN_INVOICES');
    if (hasOwn && !hasAll && resource.property) {
      const admins = (resource.property.allAdministrators || []).map((a: any) => a.toString());
      if (
        resource.property.administrator?.toString() !== user._id.toString() &&
        admins.indexOf(user._id.toString()) === -1
      ) {
        throw new ForbiddenException('Sorry, you do not have access to this resource');
      }
    }
    return resource;
  }

  // audit A8 (mass assignment): explicit allowlist of invoice fields the admin
  // invoicing screen legitimately manages (mirrors the schema / v2 body usage).
  private static readonly WRITABLE_FIELDS = [
    'invoiceNo',
    'invoiceForDate',
    'invoiceForMonthString',
    'issueDate',
    'status',
    'datepayed',
    'property',
    'completedBookings',
    'userBookings',
    'totalBookingsCount',
    'invoiceSentToProperty',
    'invoiceSentToPropertyDate',
    'reminderSentToProperty',
    'reminderSentToPropertyDate',
    'paymentUrl',
    'currency',
    'amountToProperty',
    'amountFromProperty',
    'commissionHourly',
    'commissionMonthly',
    'amount',
  ];

  private pickWritable(data: any): any {
    const out: any = {};
    for (const k of InvoicesService.WRITABLE_FIELDS) {
      if (data && Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    }
    return out;
  }

  async create(data: any) {
    const resource = new this.invoiceModel(this.pickWritable(data)); // audit A8
    await resource.save();
    await this.invoiceModel.populate(resource, populations);
    return resource;
  }

  async modify(id: string, data: any) {
    const resource: any = await this.invoiceModel.findOne({ _id: id });
    if (!resource) return null;
    data = this.pickWritable(data); // audit A8
    Object.keys(data).forEach((k) => (resource[k] = data[k]));
    await resource.save();
    await this.invoiceModel.populate(resource, populations);
    return resource;
  }

  async remove(id: string) {
    return this.invoiceModel.deleteOne({ _id: id }).exec();
  }

  /** Telr hosted-payment-page order creation (legacy getPaymentLink). */
  async getPaymentLink(id: string) {
    const invoice: any = await this.invoiceModel.findOne({ _id: id }).populate(populations).lean().exec();
    if (!invoice) return { notFound: true };

    const appUrl = this.config.get<string>('appUrl');
    const ts = Math.round(Date.now() / 1000);
    const body = {
      ivp_method: 'create',
      ivp_store: this.config.get('telr.storeId'),
      ivp_authkey: this.config.get('telr.api'),
      ivp_cart: ts,
      ivp_test: '0',
      ivp_amount: invoice.amount,
      ivp_currency: 'AED',
      ivp_desc: 'Stayhopper Payment',
      bill_fname: invoice.property?.name,
      bill_sname: invoice.property?.legal_name,
      bill_addr1: invoice.property?.location?.address,
      bill_city: invoice.property?.location?.address,
      bill_country: 'AE',
      bill_email: invoice.primaryReservationEmail,
      phone: invoice.property?.contactinfo?.mobile,
      return_auth: `${appUrl}api/payment/success?invoice_id=${invoice._id}`,
      return_can: `${appUrl}api/payment/failed?invoice_id=${invoice._id}&promocode=`,
      return_decl: `${appUrl}api/payment/failed?invoice_id=${invoice._id}&promocode=`,
    };

    try {
      const resp = await fetch('https://secure.telr.com/gateway/order.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const obj: any = await resp.json();
      if (obj && obj.order) return { order: obj.order };
      return { error: true };
    } catch (e) {
      return { error: true };
    }
  }
}
