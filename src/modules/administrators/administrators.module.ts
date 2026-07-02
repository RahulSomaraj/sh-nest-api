import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdministratorsController } from './administrators.controller';
import { AdministratorsService } from './administrators.service';
import {
  Administrator,
  AdministratorSchema,
} from './schemas/administrator.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { MailModule } from '../../common/mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Administrator.name, schema: AdministratorSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    ReferenceModelsModule,
    MailModule,
  ],
  controllers: [AdministratorsController],
  providers: [AdministratorsService],
  exports: [AdministratorsService],
})
export class AdministratorsModule {}
