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
        return {
          uri: mongo.url,
          user: mongo.username || undefined,
          pass: mongo.password || undefined,
          authSource: mongo.authSource,
          replicaSet: mongo.replicaSet,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
