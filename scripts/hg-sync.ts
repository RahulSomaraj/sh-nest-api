/**
 * Run one HyperGuest static sync from the CLI:
 *
 *   npm run hg:sync
 *
 * Same code path as the 6-hourly cron and POST /admin/v2/hyperguest/sync — this
 * just skips needing a running server and an admin JWT, which is what you want for
 * a first import.
 *
 * Scope comes from the environment (HG_COUNTRIES / HG_CITIES / HG_CITY_IDS); the
 * run prints the summary it persisted to `hg_sync_runs`. Safe to re-run: the diff
 * skips unchanged hotels, so a second run costs one feed request and no
 * property-static calls.
 *
 * NOTE: honours the same run lock as every other trigger — if a cron sync is
 * already in flight this exits with {skipped:'already running'} rather than
 * racing it.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HyperGuestSyncService } from '../src/modules/api/hyperguest/hyperguest-sync.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const sync = app.get(HyperGuestSyncService);
    const result = await sync.syncHotels('manual');
    // eslint-disable-next-line no-console
    console.log('\n--- run summary ---');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    await app.close();
    process.exit('ok' in result && result.ok ? 0 : 1);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('hg:sync failed:', (e as Error).message);
    await app.close();
    process.exit(1);
  }
}

void run();
