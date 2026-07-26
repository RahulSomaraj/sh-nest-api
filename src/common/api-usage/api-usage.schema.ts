import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApiUsageDocument = HydratedDocument<ApiUsage>;

/**
 * One row per (HTTP method + route pattern), e.g. { GET, /admin/v2/bookings/:id }.
 * `count` is incremented on every hit; `lastAccessed` records the most recent hit.
 *
 * The route is stored as the *pattern* (…/:id), not the concrete URL, so all hits to
 * the same endpoint aggregate into a single row instead of exploding per id.
 *
 * On boot, ApiUsageService seeds every registered route at count:0 — so endpoints that
 * are never called still appear here with count:0 and are trivially found (= unused API).
 */
@Schema({ collection: 'api_usage', timestamps: true })
export class ApiUsage {
  @Prop({ required: true, uppercase: true })
  method: string;

  @Prop({ required: true })
  route: string;

  @Prop({ type: Number, default: 0 })
  count: number;

  @Prop({ type: Date })
  lastAccessed: Date;
}

export const ApiUsageSchema = SchemaFactory.createForClass(ApiUsage);

// One row per endpoint; the upsert filter relies on this being unique.
ApiUsageSchema.index({ method: 1, route: 1 }, { unique: true });
// Fast "least used first" / "unused" scans for the audit report.
ApiUsageSchema.index({ count: 1 });
