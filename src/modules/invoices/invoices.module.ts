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

/**
 * Port of stayhopper/admin/controllers/v2/invoices.js -> /admin/v2/invoices
 * list is open to any authenticated admin (legacy check commented); single/create/modify/
 * remove/get-payment-link require LIST_INVOICES. Owner scoping (LIST_ALL vs LIST_OWN_INVOICES)
 * applied in the service.
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  private perms(req: any): string[] {
    return req.user?.role?.permissions || [];
  }

  @Get()
  list(@Req() req: any, @Query() query: any) {
    return this.service.list(query, req.user, this.perms(req));
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
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
