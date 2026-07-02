import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

export type AdministratorDocument = HydratedDocument<Administrator> & {
  validPassword(password: string): Promise<boolean>;
};

/**
 * Mirrors stayhopper/db/models/administrators.js (collection: "administrators").
 * email / password / activationCode / autoLoginCode keep `select: false` so they
 * must be explicitly requested, exactly like the legacy model.
 */
// audit A1: strip secrets whenever a doc is serialised (login/create responses, JWT signing).
const stripSecrets = (_doc: unknown, ret: Record<string, any>) => {
  delete ret.password;
  delete ret.activationCode;
  delete ret.autoLoginCode;
  return ret;
};

@Schema({
  collection: 'administrators',
  timestamps: true,
  toJSON: { transform: stripSecrets },
  toObject: { transform: stripSecrets },
})
export class Administrator {
  @Prop({ required: [true, 'Name is required'] })
  name: string;

  @Prop({ unique: true, required: [true, 'Email Address is required'], select: false })
  email: string;

  @Prop({ type: Boolean, required: true, default: true })
  status: boolean;

  @Prop({ required: [true, 'Password is required'], select: false })
  password: string;

  @Prop({ type: Types.ObjectId, ref: 'Role' })
  role: Types.ObjectId;

  @Prop({ select: false })
  activationCode: string;

  @Prop({ select: false })
  autoLoginCode: string;

  @Prop()
  contact_person: string;

  @Prop()
  legal_name: string;

  @Prop({ type: Types.ObjectId, ref: 'countries' })
  country: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'cities' })
  city: Types.ObjectId;

  @Prop()
  address_1: string;

  @Prop()
  address_2: string;

  @Prop()
  location: string;

  @Prop({ type: [Number] })
  latlng: number[];

  @Prop()
  zip: string;

  @Prop()
  mobile: string;

  @Prop()
  land_phone: string;

  @Prop({ type: [String] })
  alt_land_phone: string[];

  @Prop({ type: Number })
  rating: number;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'properties' }] })
  properties: Types.ObjectId[];
}

export const AdministratorSchema = SchemaFactory.createForClass(Administrator);

// Parity with AdministratorSchema.methods.validPassword
AdministratorSchema.methods.validPassword = async function (
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, this.password);
};
