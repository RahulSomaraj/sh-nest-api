import { Schema, SchemaTypes } from 'mongoose';

/**
 * Mirrors `stayhopper/db/models/notificationlogs.js` (collection: `notificationlogs`).
 *
 * One row per push attempt, written by the cron jobs so a missing notification can be
 * traced afterwards. NOTE: the legacy `ref` is `"userbooking"` (singular) — a model name
 * that does not exist — so the ref never resolves. Kept as a plain ObjectId here rather
 * than pointing it at `userbookings`, which would change how existing rows populate.
 */
export const NotificationLogSchema = new Schema(
  {
    device_token: { type: String },
    type: { type: String },
    status: { type: String },
    booking_id: { type: SchemaTypes.ObjectId },
  },
  { collection: 'notificationlogs', timestamps: false },
);
