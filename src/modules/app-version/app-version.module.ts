import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Put,
  UseGuards,
} from '@nestjs/common';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Port of stayhopper/admin/controllers/v2/app-version.js -> /admin/v2/app-version
 * GET / returns the android + ios rows; PUT / updates the row matched by appType.
 *
 * The legacy model omitted the `appType` field it filters on; kept here (strict:false)
 * so existing docs load and PUT persists it. Guarded with JwtAuthGuard (hardening: the
 * legacy admin route had no guard, but the admin panel is authenticated).
 */
export const AppVersionSchema = new Schema(
  {
    appType: { type: String },
    buildVersion: { type: String },
    appVersion: { type: String },
    forceUpdate: { type: Boolean },
  },
  { collection: 'app_version', timestamps: true, strict: false },
);

@Injectable()
export class AppVersionService {
  constructor(@InjectModel('app_version') private readonly model: Model<any>) {}

  async get() {
    const [android, ios] = await Promise.all([
      this.model.findOne({ appType: 'android' }).lean().exec(),
      this.model.findOne({ appType: 'ios' }).lean().exec(),
    ]);
    return { success: true, data: { android, ios } };
  }

  async modify(body: any) {
    const resourceData = { ...body };
    delete resourceData._id;
    const resource: any = await this.model.findOne({ appType: body.appType });
    if (!resource) return null;
    Object.keys(resourceData).forEach((key) => {
      resource[key] = resourceData[key];
    });
    await resource.save();
    return { success: 'true' };
  }
}

@Controller('app-version')
@UseGuards(JwtAuthGuard)
export class AppVersionController {
  constructor(private readonly service: AppVersionService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Put()
  async modify(@Body() body: any) {
    const result = await this.service.modify(body);
    if (!result) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: 'app_version', schema: AppVersionSchema }])],
  controllers: [AppVersionController],
  providers: [AppVersionService],
})
export class AppVersionModule {}
