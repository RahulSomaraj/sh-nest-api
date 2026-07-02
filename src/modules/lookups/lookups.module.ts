import {
  Controller,
  Get,
  Injectable,
  Query,
  UseGuards,
  Module,
} from '@nestjs/common';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleSchema } from '../administrators/schemas/role.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Port of stayhopper/admin/controllers/v2/lookups.js -> /admin/v2/lookups
 * Only GET /lookups/roles is live (paginated roles). Authenticated admins only.
 */
@Injectable()
export class LookupsService {
  constructor(@InjectModel(Role.name) private readonly roleModel: Model<any>) {}

  async listRoles(query: any, basePath = '/admin/v2/lookups/roles') {
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
    const activePage = parseInt(query.page, 10) || 1;
    const skip = (activePage - 1) * limit;

    let sort: any = { _id: 1 };
    if (query.order && query.orderBy) {
      sort = {};
      sort[query.orderBy] = query.order === 'asc' ? 1 : -1;
    }

    const [list, itemCount] = await Promise.all([
      this.roleModel.find({}).sort(sort).limit(limit).skip(skip).lean().exec(),
      this.roleModel.countDocuments({}),
    ]);

    const pageCount = Math.ceil(itemCount / limit);
    const pages: { number: number; url: string }[] = [];
    const maxPages = 10;
    let start = Math.max(1, activePage - Math.floor(maxPages / 2));
    const end = Math.min(pageCount, start + maxPages - 1);
    start = Math.max(1, Math.min(start, Math.max(1, end - maxPages + 1)));
    for (let n = start; n <= end; n++) pages.push({ number: n, url: `${basePath}?page=${n}&limit=${limit}` });

    return { list, itemCount, pageCount, pages, active_page: activePage };
  }
}

@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookupsService: LookupsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('roles')
  listRoles(@Query() query: any) {
    return this.lookupsService.listRoles(query);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }])],
  controllers: [LookupsController],
  providers: [LookupsService],
})
export class LookupsModule {}
