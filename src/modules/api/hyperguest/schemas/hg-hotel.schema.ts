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
 *
 * The doc is inserted as `status:'running'` before the loop and updated in place
 * (per batch, then terminally), so a run interrupted by a crash or deploy still
 * leaves a diagnosable trail instead of nothing.
 */
export const HgSyncRunSchema = new Schema(
  {
    trigger: { type: String, enum: ['cron', 'manual'] },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    feedTotal: Number,
    skippedByCertification: Number,
    duplicatesCollapsed: Number,
    created: Number,
    updated: Number,
    unpublished: Number,
    unchanged: Number,
    /** Capped at the first 100; errorCount carries the true total. */
    errors: [{ hotel_id: Number, message: String }],
    errorCount: Number,
    invariantOk: Boolean,
    ok: Boolean,
  },
  {
    collection: 'hg_sync_runs',
    timestamps: true,
    // `errors` is a reserved Mongoose pathname; the field name is part of the
    // persisted run shape, so keep it and silence the boot warning.
    suppressReservedKeysWarning: true,
  },
);

HgSyncRunSchema.index({ startedAt: -1 });

/**
 * Cross-instance run lock. `POST /admin/v2/hyperguest/sync` and the 6-hourly cron
 * both call syncHotels(), and a full-feed run outlives the cron interval — so runs
 * WILL overlap and race on the same upserts. Under PM2 multi-instance an in-process
 * flag is useless, so the lock is this partial unique index: the second concurrent
 * insert of a `running` row fails with E11000 and that run backs off.
 *
 * MIGRATION NOTE (CLAUDE.md — shared live MongoDB): new index on a NEW collection,
 * additive. The partial filter means pre-existing rows (no `status` field) are not
 * covered and cannot collide.
 */
HgSyncRunSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: 'running' } },
);
