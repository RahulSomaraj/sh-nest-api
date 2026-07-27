import { Schema, SchemaTypes } from 'mongoose';

/**
 * NEW collection `hg_hotels` — mirror of the HyperGuest static feed plus the link
 * to the materialized `properties` doc (HYPERGUEST_PLAN.md slab B, decision D1).
 * One row per HG hotel_id ever seen; `active:false` when the hotel drops out of
 * the feed (the linked property is unpublished, never deleted).
 *
 * MIGRATION NOTE (CLAUDE.md — shared live MongoDB): new collection + new indexes
 * {hotel_id unique}, {active}. Additive only; no existing collection touched.
 */
export const HgHotelSchema = new Schema(
  {
    hotel_id: { type: Number, required: true },
    name: String,
    country: String,
    city: String,
    region: String,
    city_Id: Number,
    /** Feed delta marker as-received; refetch static when it moves. */
    last_updated: String,
    version: Number,
    /** In the current feed? false = dropped off → property unpublished. */
    active: { type: Boolean, default: true },
    /** Materialized properties doc (source:'HyperGuest'). */
    property: { type: SchemaTypes.ObjectId, ref: 'properties' },
    /** Raw property-static.json blob (shape verified during certification). */
    static: { type: SchemaTypes.Mixed, select: false },
    staticFetchedAt: Date,
  },
  { collection: 'hg_hotels', timestamps: true },
);

HgHotelSchema.index({ hotel_id: 1 }, { unique: true });
HgHotelSchema.index({ active: 1 });

/**
 * NEW collection `hg_sync_runs` — one doc per sync run (cron or manual trigger),
 * pruned to the most recent 50. Shape = HgSyncSummary (hyperguest.types.ts).
 */
export const HgSyncRunSchema = new Schema(
  {
    trigger: { type: String, enum: ['cron', 'manual'] },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    feedTotal: Number,
    skippedByCertification: Number,
    created: Number,
    updated: Number,
    unpublished: Number,
    unchanged: Number,
    errors: [{ hotel_id: Number, message: String }],
    invariantOk: Boolean,
    ok: Boolean,
  },
  { collection: 'hg_sync_runs', timestamps: true },
);

HgSyncRunSchema.index({ startedAt: -1 });
