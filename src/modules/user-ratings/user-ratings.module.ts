import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserRatingsController } from './user-ratings.controller';
import { UserRatingsService } from './user-ratings.service';
import { UserRating, UserRatingSchema } from './schemas/user-rating.schema';
import { ReferenceModelsModule } from '../../common/reference/reference.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserRating.name, schema: UserRatingSchema },
    ]),
    // properties (recompute rating + list) and users (populate) models
    ReferenceModelsModule,
  ],
  controllers: [UserRatingsController],
  providers: [UserRatingsService],
  exports: [UserRatingsService],
})
export class UserRatingsModule {}
