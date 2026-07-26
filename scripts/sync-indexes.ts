/**
 * Explicit index builder. Boots a headless Nest application context
 * (NestFactory.createApplicationContext) so it reuses DatabaseModule's connection and
 * every schema registered across the app, then ensures each model's declared indexes
 * exist in MongoDB.
 *
 * Why this exists: in production DatabaseModule sets `autoIndex: false` (building indexes
 * automatically on boot can block a hot collection). Run this once as part of a deploy —
 * after code is shipped — to create any new indexes without dropping existing ones.
 *
 * Usage:
 *   npm run indexes:sync
 *
 * Uses Model.createIndexes() (non-destructive: creates missing indexes, never drops).
 * If you intentionally want the DB indexes to exactly match the schemas (dropping any
 * extras), switch createIndexes() to syncIndexes() below — do that deliberately, as it
 * removes indexes not declared in code.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let failures = 0;
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const names = connection.modelNames().sort();
    // eslint-disable-next-line no-console
    console.log(`Building indexes for ${names.length} models on "${connection.name}"...`);

    for (const name of names) {
      const model = connection.model(name);
      try {
        await model.createIndexes();
        const idx = await model.collection.indexes().catch(() => []);
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${name} (${idx.length} indexes)`);
      } catch (e: any) {
        failures += 1;
        // eslint-disable-next-line no-console
        console.error(`  ✗ ${name}: ${e?.message ?? e}`);
      }
    }
  } finally {
    await app.close();
  }

  if (failures) {
    // eslint-disable-next-line no-console
    console.error(`Index sync completed with ${failures} failure(s).`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('Index sync complete.');
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
