/**
 * HyperGuest import status — read-only snapshot of what is actually in the DB.
 *
 * Answers: how many hotels did we import, how many are live, which cities, did
 * the last run finish, and are there any hotels the feed knows about that we
 * never successfully fetched.
 *
 *   npm run hg:status              # summary + top cities
 *   npm run hg:status -- --cities 30   # more city rows
 *   npm run hg:status -- --errors      # also list the last run's stored errors
 *
 * Boots a headless Nest context (same pattern as scripts/seed-properties.ts) so
 * it reads through the app's own connection and models. Writes nothing.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const pct = (n: number, total: number): string =>
  total ? `${((n / total) * 100).toFixed(1)}%` : '—';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const get = <T = any>(token: string) =>
      app.get<Model<T>>(getModelToken(token), { strict: false });

    const hgHotelModel = get('hg_hotels');
    const hgSyncRunModel = get('hg_sync_runs');
    const propertyModel = get('properties');

    const [
      hotelsTotal,
      hotelsActive,
      hotelsInactive,
      withStatic,
      withProperty,
      propsTotal,
      propsPublished,
      propsWithImages,
      propsWithGeo,
    ] = await Promise.all([
      hgHotelModel.countDocuments({}),
      hgHotelModel.countDocuments({ active: true }),
      hgHotelModel.countDocuments({ active: false }),
      hgHotelModel.countDocuments({ staticFetchedAt: { $ne: null } }),
      hgHotelModel.countDocuments({ property: { $ne: null } }),
      propertyModel.countDocuments({ source: 'HyperGuest' }),
      propertyModel.countDocuments({ source: 'HyperGuest', published: true }),
      propertyModel.countDocuments({ source: 'HyperGuest', 'images.0': { $exists: true } }),
      propertyModel.countDocuments({
        source: 'HyperGuest',
        'location.coordinates.0': { $exists: true },
      }),
    ]);

    console.log('\n═══ HyperGuest import status ═══════════════════\n');
    console.log('hg_hotels (supplier index)');
    console.log(`  total rows            ${hotelsTotal}`);
    console.log(`  active (in scope)     ${hotelsActive}`);
    console.log(`  inactive (dropped)    ${hotelsInactive}`);
    console.log(`  with static content   ${withStatic}  (${pct(withStatic, hotelsTotal)})`);
    console.log(`  linked to a property  ${withProperty}  (${pct(withProperty, hotelsTotal)})`);

    console.log('\nproperties (source: HyperGuest)');
    console.log(`  total                 ${propsTotal}`);
    console.log(`  published (sellable)  ${propsPublished}`);
    console.log(`  with images           ${propsWithImages}  (${pct(propsWithImages, propsTotal)})`);
    console.log(`  with coordinates      ${propsWithGeo}  (${pct(propsWithGeo, propsTotal)})`);

    // The sync's own invariant: one active supplier row ↔ one published property.
    const invariantOk = hotelsActive === propsPublished;
    console.log(
      `\ninvariant  active hg_hotels (${hotelsActive}) === published properties (${propsPublished})  ` +
        `${invariantOk ? '✔ OK' : '✖ BROKEN'}`,
    );
    if (!invariantOk) {
      console.log(
        '  → a mismatch means some rows never finished materializing; the next sync retries them.',
      );
    }

    // Per-city breakdown — the answer to "did Dubai actually land".
    const cityLimit = Math.max(1, parseInt(arg('--cities') || '', 10) || 15);
    const byCity = await hgHotelModel.aggregate([
      {
        $group: {
          _id: { city: '$city', city_Id: '$city_Id' },
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$active', 1, 0] } },
          withStatic: { $sum: { $cond: [{ $ifNull: ['$staticFetchedAt', false] }, 1, 0] } },
        },
      },
      { $sort: { active: -1, total: -1 } },
      { $limit: cityLimit },
    ]);

    if (byCity.length) {
      console.log(`\nby city (top ${cityLimit} by active)`);
      console.log('  city                      city_Id   active   total   w/static');
      for (const c of byCity) {
        const city = String(c._id.city ?? '—').slice(0, 24).padEnd(24);
        const id = String(c._id.city_Id ?? '—').padStart(7);
        console.log(
          `  ${city}${id}${String(c.active).padStart(9)}${String(c.total).padStart(8)}` +
            `${String(c.withStatic).padStart(11)}`,
        );
      }
    }

    // Last few runs — status tells you whether an import finished or was killed.
    const runs = await hgSyncRunModel.find({}).sort({ startedAt: -1 }).limit(5).lean().exec();
    console.log('\nrecent sync runs');
    if (!runs.length) {
      console.log('  (none — the sync has never run against this database)');
    }
    for (const r of runs as any[]) {
      const when = new Date(r.startedAt).toISOString().replace('T', ' ').slice(0, 19);
      const mins = r.durationMs ? (r.durationMs / 60000).toFixed(1) : '?';
      console.log(
        `  ${when}  ${String(r.status).padEnd(9)} ${String(r.trigger).padEnd(6)} ` +
          `feed=${r.feedTotal ?? '?'} new=${r.created ?? 0} upd=${r.updated ?? 0} ` +
          `unch=${r.unchanged ?? 0} citySkip=${r.skippedByCity ?? 0} ` +
          `certSkip=${r.skippedByCertification ?? 0} err=${r.errorCount ?? 0} (${mins} min)`,
      );
      if (r.scope && (r.scope.cities?.length || r.scope.cityIds?.length)) {
        console.log(
          `      scope: cities=[${(r.scope.cities || []).join(', ')}] ids=[${(r.scope.cityIds || []).join(', ')}]`,
        );
      }
    }

    const running = runs.find((r: any) => r.status === 'running');
    if (running) {
      console.log(
        '\n⚠  A run is currently marked `running` — either it is in flight now, or it was ' +
          'killed mid-flight (the lock auto-reaps after 6h).',
      );
    }

    if (process.argv.includes('--errors') && (runs[0] as any)?.errors?.length) {
      console.log('\nlast run — stored errors (capped at 100)');
      for (const e of (runs[0] as any).errors.slice(0, 25)) {
        console.log(`  hotel ${e.hotel_id}: ${e.message}`);
      }
    }

    // Hotels the feed gave us but whose content never arrived — the true "still
    // to do" list. These are retried automatically by the next sync.
    const missingStatic = await hgHotelModel
      .find({ active: true, staticFetchedAt: null }, { hotel_id: 1, name: 1 })
      .limit(10)
      .lean()
      .exec();
    if (missingStatic.length) {
      console.log(
        `\n⚠  ${missingStatic.length}+ active hotels have no static content yet — run the sync again:`,
      );
      console.log(`   ${missingStatic.map((m: any) => m.hotel_id).join(', ')}`);
    }

    console.log('\n════════════════════════════════════════════════\n');
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✖ hg:status failed:', err?.message || err);
    process.exit(1);
  });
