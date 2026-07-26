import { Schema } from 'mongoose';

/**
 * Mirrors `stayhopper/db/models/cron_blockslots.js` (collection: `cron_blockslots`).
 *
 * The extranet writes a row here when a hotel bulk-blocks or bulk-unblocks inventory;
 * the worker below picks it up and applies it to the `bookings` slot arrays.
 * NOTE: `room` / `property` / `from_slot` / `to_slot` are STRINGS in the legacy model,
 * not ObjectIds — kept as-is so both apps read and write the same documents.
 */
export const CronBlockSlotSchema = new Schema(
  {
    from_date: { type: String },
    to_date: { type: String },
    room: { type: String },
    property: { type: String },
    from_slot: { type: String },
    to_slot: { type: String },
    block_type: { type: String, enum: ['UNBLOCK', 'BLOCK'], default: 'BLOCK' },
    status: { type: Boolean, default: false },
    is_last: { type: Boolean, default: false },
    user_email: { type: String },
  },
  { collection: 'cron_blockslots', timestamps: false },
);
