import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;
export type NotificationChildDocument = HydratedDocument<NotificationChild>;

/**
 * Mirrors stayhopper/db/models/notifications.js (collection: "notifications").
 * NOTE: the legacy schema has no timestamps — keep it that way so documents written
 * by nest and by legacy stay identical while both run.
 */
@Schema({ collection: 'notifications', timestamps: false })
export class Notification {
  @Prop({ type: String })
  title: string;

  @Prop({ type: String })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'userbookings' })
  book_id: Types.ObjectId;

  @Prop({ type: String })
  booking_no: string;

  @Prop({
    type: String,
    enum: ['GENERAL', 'EXTEND', 'BOOKED', 'REVIEW'],
    default: 'GENERAL',
  })
  notification_type: string;

  @Prop({ type: String })
  device_token: string;

  @Prop({ type: String })
  property_name: string;

  @Prop({ type: Types.ObjectId, ref: 'properties' })
  property_id: Types.ObjectId;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/**
 * Mirrors stayhopper/db/models/notification_childs.js (collection: "notification_childs").
 * One row per recipient of a notification.
 */
@Schema({ collection: 'notification_childs', timestamps: false })
export class NotificationChild {
  @Prop({ type: Types.ObjectId, ref: 'notifications' })
  notification_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'users' })
  user_id: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  read_status: boolean;
}

export const NotificationChildSchema =
  SchemaFactory.createForClass(NotificationChild);

// The two customer reads both filter by user_id (+ read_status for the counter) and
// sort by read_status/_id — legacy had no index and scanned the collection.
NotificationChildSchema.index({ user_id: 1, read_status: 1, _id: -1 });
