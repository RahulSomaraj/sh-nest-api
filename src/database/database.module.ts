import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

/**
 * Mirrors stayhopper/db/mongodb.js — connects with the same auth options so the
 * NestJS app can point at the existing MongoDB during cutover.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mongo = config.get('mongo');
        // audit DB: don't build indexes automatically in production — index builds on a
        // hot collection can block. Prod builds them explicitly via `npm run indexes:sync`
        // (scripts/sync-indexes.ts). In dev/staging autoIndex stays on for convenience.
        // Override with MONGO_AUTOINDEX=true|false if you need to force it.
        const autoIndex =
          process.env.MONGO_AUTOINDEX !== undefined
            ? process.env.MONGO_AUTOINDEX === 'true'
            : process.env.NODE_ENV !== 'production';
        return {
          uri: mongo.url,
          user: mongo.username || undefined,
          pass: mongo.password || undefined,
          authSource: mongo.authSource,
          replicaSet: mongo.replicaSet,
          autoIndex,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
