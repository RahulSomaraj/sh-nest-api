import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';

@Module({
  controllers: [CommissionsController],
})
export class CommissionsModule {}
