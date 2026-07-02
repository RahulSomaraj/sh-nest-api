import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';

const UserRatingLooseSchema = new Schema({}, { strict: false, collection: 'userratings' });

const has = (permissions: string[], p: string) =>
  permissions.indexOf('*') > -1 || permissions.indexOf(p) > -1;

/**
 * Port of stayhopper/admin/controllers/v2/dashboard.js -> /admin/v2/dashboard
 * Count aggregates for the admin dashboard. All routes require SHOW_DASHBOARD; scope is
 * SHOW_FULL_DASHBOARD vs SHOW_OWN_DASHBOARD (own = the admin's properties).
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectModel('properties') private readonly propertyModel: Model<any>,
    @InjectModel('userbookings') private readonly userBookingModel: Model<any>,
    @InjectModel('completed_bookings') private readonly completedModel: Model<any>,
    @InjectModel('userratings') private readonly userRatingModel: Model<any>,
    @InjectModel('users') private readonly userModel: Model<any>,
    @InjectModel('invoices') private readonly invoiceModel: Model<any>,
  ) {}

  private async ownPropertyIds(user: any) {
    const props = await this.propertyModel
      .find({ $or: [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }] })
      .select('_id')
      .lean();
    return props.map((p: any) => p._id);
  }

  private isOwnScoped(permissions: string[]) {
    return has(permissions, 'SHOW_OWN_DASHBOARD') && !has(permissions, 'SHOW_FULL_DASHBOARD');
  }

  async getProperties(user: any, permissions: string[]) {
    const whereTotal: any = {};
    const whereLive: any = { approved: true, published: true };
    if (this.isOwnScoped(permissions)) {
      const or = [{ administrator: user._id }, { allAdministrators: { $in: [user._id] } }];
      whereTotal.$and = [{ $or: or }];
      whereLive.$and = [{ $or: or }];
    }
    const [count, countLive, countSourceExtranet, countSourceWebsite] = await Promise.all([
      this.propertyModel.countDocuments(whereTotal),
      this.propertyModel.countDocuments(whereLive),
      this.propertyModel.countDocuments({
        $or: [{ source: '' }, { source: 'Extranet' }, { source: { $exists: false } }],
      }),
      this.propertyModel.countDocuments({ source: 'Website' }),
    ]);
    return { count, countLive, countSourceExtranet, countSourceWebsite };
  }

  async getBookings(user: any, permissions: string[]) {
    const whereActive: any = {};
    const whereCompleted: any = {};
    if (this.isOwnScoped(permissions)) {
      const ids = await this.ownPropertyIds(user);
      whereActive.$and = [{ $or: [{ property: { $in: ids } }] }];
      whereCompleted.$and = [{ $or: [{ 'propertyInfo.id': { $in: ids } }] }];
    }
    const [countActive, countCompleted] = await Promise.all([
      this.userBookingModel.countDocuments(whereActive),
      this.completedModel.countDocuments(whereCompleted),
    ]);
    return { countActive, countCompleted };
  }

  async getUserRatings(user: any, permissions: string[]) {
    const whereUnapproved: any = { approved: false };
    const whereApproved: any = { approved: true };
    if (this.isOwnScoped(permissions)) {
      const ids = await this.ownPropertyIds(user);
      whereUnapproved.$and = [{ $or: [{ property: { $in: ids } }] }];
      whereApproved.$and = [{ $or: [{ property: { $in: ids } }] }];
    }
    const [countUnapproved, countApproved] = await Promise.all([
      this.userRatingModel.countDocuments(whereUnapproved),
      this.userRatingModel.countDocuments(whereApproved),
    ]);
    return { countUnapproved, countApproved };
  }

  async getUsers(permissions: string[]) {
    if (!has(permissions, 'SHOW_FULL_DASHBOARD')) {
      throw new ForbiddenException('Sorry, you do not have access to this resource');
    }
    const [count, latest] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.find().sort({ createdAt: -1, _id: -1 }).limit(5).lean(),
    ]);
    return { count, latest };
  }

  async getInvoices(user: any, permissions: string[]) {
    const where: any = { status: 'pending' };
    if (this.isOwnScoped(permissions)) {
      const ids = await this.ownPropertyIds(user);
      where.$and = [{ $or: [{ administrator: user._id }, { property: { $in: ids } }] }];
    }
    const count = await this.invoiceModel.countDocuments(where);
    return { count };
  }
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('SHOW_DASHBOARD')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  private perms(req: any): string[] {
    return req.user?.role?.permissions || [];
  }

  @Get('properties')
  properties(@Req() req: any) {
    return this.service.getProperties(req.user, this.perms(req));
  }

  @Get('bookings')
  bookings(@Req() req: any) {
    return this.service.getBookings(req.user, this.perms(req));
  }

  @Get('user-ratings')
  userRatings(@Req() req: any) {
    return this.service.getUserRatings(req.user, this.perms(req));
  }

  @Get('users')
  users(@Req() req: any) {
    return this.service.getUsers(this.perms(req));
  }

  @Get('invoices')
  invoices(@Req() req: any) {
    return this.service.getInvoices(req.user, this.perms(req));
  }
}

@Module({
  imports: [
    ReferenceModelsModule,
    MongooseModule.forFeature([
      { name: 'invoices', schema: InvoiceSchema },
      { name: 'userratings', schema: UserRatingLooseSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
