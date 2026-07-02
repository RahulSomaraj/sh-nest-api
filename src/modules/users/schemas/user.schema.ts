import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

export type UserDocument = HydratedDocument<User> & {
  validPassword(password: string): Promise<boolean>;
};

const emailRegex =
  /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

/**
 * Mirrors stayhopper/db/models/users.js (collection: "users").
 * Note: unlike administrators, email/password are NOT select:false here — the legacy
 * model returns them by default.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: [true, 'Name is required'] })
  name: string;

  @Prop()
  last_name: string;

  @Prop({
    trim: true,
    lowercase: true,
    unique: true,
    required: [true, 'Email is required'],
    match: [emailRegex, 'Please fill a valid email address'],
  })
  email: string;

  @Prop({ trim: true })
  mobile: string;

  @Prop()
  city: string;

  @Prop()
  country: string;

  @Prop()
  dateOfBirth: string;

  @Prop({ enum: ['male', 'female', 'other'], default: 'other' })
  gender: string;

  @Prop({ type: Types.ObjectId, ref: 'cities' })
  city_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'countries' })
  country_id: Types.ObjectId;

  @Prop()
  image: string;

  @Prop({ type: Number, required: [true, 'isGuestUser is required'] })
  isGuestUser: number;

  @Prop({ required: [true, 'Password is required'] })
  password: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'properties' }] })
  favourites: Types.ObjectId[];

  @Prop({ type: Number, default: 1 })
  status: number;

  @Prop({ type: Boolean, default: false })
  deleted: boolean;

  @Prop({ type: [String] })
  promocodes: string[];

  @Prop()
  device_type: string;

  @Prop()
  device_token: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Parity with usersSchema.methods.validPassword
UserSchema.methods.validPassword = async function (
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, this.password);
};
