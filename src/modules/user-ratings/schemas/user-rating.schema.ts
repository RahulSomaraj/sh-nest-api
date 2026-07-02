import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserRatingDocument = HydratedDocument<UserRating>;

/**
 * Mirrors stayhopper/db/models/userratings.js (collection: "userratings").
 */
@Schema({ collection: 'userratings', timestamps: true })
export class UserRating {
  @Prop({ type: Types.ObjectId, ref: 'users', required: [true, 'User details required'] })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  ub_id: Types.ObjectId;

  @Prop({ type: String, default: '' })
  booking_id: string;

  @Prop({ type: Types.ObjectId, ref: 'properties', required: [true, 'Property details required'] })
  property: Types.ObjectId;

  @Prop({ required: [true, 'User comment is required'] })
  comment: string;

  @Prop({ type: Number, required: [true, 'Rating value is required'] })
  value: number;

  @Prop({ type: Date })
  date: Date;

  @Prop({ type: Boolean, default: false })
  approved: boolean;
}

export const UserRatingSchema = SchemaFactory.createForClass(UserRating);

// Query performance: list filters by property + approved and sorts; index the hot paths.
UserRatingSchema.index({ property: 1, approved: 1 });
