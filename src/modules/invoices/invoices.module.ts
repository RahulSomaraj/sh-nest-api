import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvoicesService } from './invoices.service';
import { InvoiceSchema } from './schemas/invoice.schema';
import { ReferenceModelsModule } from '../../common/reference/reference.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { JobsModule } from '../jobs/jobs.module';
import { InvoicesJobService } from '../jobs/invoices-job.service';

/**
 * Port of stayhopper/admin/controllers/v2/invoices.js -> /admin/v2/invoices
 * list is open to any authenticated admin (legacy check commented); single/create/modify/
 * remove/get-payment-link require LIST_INVOICES. Owner scoping (LIST_ALL vs LIST_OWN_INVOICES)
 * applied in the service.
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly invoicesJobService: InvoicesJobService,
  ) {}

  private perms(req: any): string[] {
    return req.user?.role?.permissions || [];
  }

  @Get()
  list(@Req() req: any, @Query() query: any) {
    return this.service.list(query, req.user, this.perms(req));
  }

  /**
   * MIGRATION.md C9 — manual monthly invoice generation.
   *
   * Replaces the legacy `GET /generate-invoice` (mounted at the app root in
   * `sh-api/index.js:80` with **no authentication at all** — anyone could regenerate and
   * re-email every property's invoices). Declared before `:id` so it isn't swallowed by
   * the parameterised route.
   *
   * Query: `from` / `to` (`DD-MM-YYYY`, whole months) or neither for last month;
   * `disableEmailToProperty=true` to generate without notifying properties.
   */
  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_ALL_INVOICES')
  @Post('generate')
  generate(@Query() query: any) {
    return this.invoicesJobService.generateInvoices({
      date: query.date,
      from: query.from,
      to: query.to,
      disableEmailToProperty: query.disableEmailToProperty === 'true',
    });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_INVOICES')
  @Get(':id/get-payment-link')
  async getPaymentLink(@Param('id') id: string) {
    const r = await this.service.getPaymentLink(id);
    if ((r as any).notFound) throw new HttpException({ message: 'Invoices does not exist' }, HttpStatus.NOT_FOUND);
    if ((r as any).error) {
      throw new HttpException(
        { message: 'Sorry, there was an error in performing this operation' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return (r as any).order;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_INVOICES')
  @Get(':id')
  async single(@Req() req: any, @Param('id') id: string) {
    const r = await this.service.single(id, req.user, this.perms(req));
    if ((r as any).notFound) throw new HttpException({ message: 'Invoices does not exist' }, HttpStatus.NOT_FOUND);
    return r;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_INVOICES')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_INVOICES')
  @Put(':id')
  async modify(@Param('id') id: string, @Body() body: any) {
    const r = await this.service.modify(id, body);
    if (!r) throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    return r;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_INVOICES')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  imports: [
    ReferenceModelsModule,
    MongooseModule.forFeature([{ name: 'invoices', schema: InvoiceSchema }]),
    // Supplies InvoicesJobService for the manual `POST /generate` trigger (C9).
    JobsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
