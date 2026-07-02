import { Schema, SchemaTypes } from 'mongoose';

const oid = (ref: string) => ({ type: SchemaTypes.ObjectId, ref });

/** Port of stayhopper/db/models/invoices.js (collection: "invoices"). */
export const InvoiceSchema = new Schema(
  {
    invoiceNo: String,
    invoiceForDate: String,
    invoiceForMonthString: String,
    issueDate: Date,
    status: { type: String, enum: ['paid', 'pending', 'rejected'] },
    datepayed: Date,
    property: { ...oid('properties'), required: [true, 'Property is required'] },
    completedBookings: [oid('completed_bookings')],
    userBookings: [oid('userbookings')],
    totalBookingsCount: Number,
    invoiceSentToProperty: { type: Boolean, default: false },
    invoiceSentToPropertyDate: Date,
    reminderSentToProperty: { type: Boolean, default: false },
    reminderSentToPropertyDate: Date,
    paymentUrl: String,
    currency: oid('currencies'),
    amountToProperty: { type: Number, default: 0 },
    amountFromProperty: { type: Number, default: 0 },
    commissionHourly: Number,
    commissionMonthly: Number,
    amount: { type: Number, default: 0 },
  },
  { collection: 'invoices', timestamps: true },
);

InvoiceSchema.index({ property: 1 });
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ invoiceForDate: 1 });
