import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContactUsDocument = HydratedDocument<ContactUs>;

/**
 * Mirrors stayhopper/db/models/contactus.js (collection: "contactus").
 */
@Schema({ collection: 'contactus', timestamps: true })
export class ContactUs {
  @Prop({ type: String })
  name: string;

  @Prop({ type: String })
  email: string;

  @Prop({ type: String })
  subject: string;

  @Prop({ type: String })
  message: string;

  @Prop({ type: Date, default: Date.now })
  date: Date;
}

export const ContactUsSchema = SchemaFactory.createForClass(ContactUs);
