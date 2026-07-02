import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';

/**
 * Port of stayhopper/admin/controllers/v2/bookings.js -> /admin/v2/bookings
 * Read + cancellation/no-show workflow endpoints (no create/modify — commented out in legacy).
 * All routes require an authenticated admin. `single` additionally requires LIST_BOOKINGS;
 * owner scoping (LIST_ALL vs LIST_OWN_BOOKINGS) + guest masking is applied in the service.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  private perms(req: any): string[] {
    return req.user?.role?.permissions || [];
  }

  @Get()
  list(@Req() req: any, @Query() query: any) {
    return this.bookingsService.list(query, req.user, this.perms(req));
  }

  // audit A7: req.user passed through so the service can owner-scope by-id workflows.
  @Post('cancel')
  async cancel(@Req() req: any, @Body('id') id: string) {
    const r = await this.bookingsService.cancel(id, req.user);
    if ((r as any).error) {
      throw new HttpException({ message: 'Could not cancel booking' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return r;
  }

  @Post('reject-cancellation/:id')
  reject(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.rejectCancellation(id, req.user);
  }

  @Post('noshow')
  async noShow(@Req() req: any, @Body('id') id: string) {
    const r = await this.bookingsService.noShow(id, req.user);
    if ((r as any).error) {
      throw new HttpException({ message: 'Could not Noshow booking' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return r;
  }

  @Post('reject-noshow/:id')
  rejectNoShow(@Req() req: any, @Param('id') id: string) {
    return this.bookingsService.rejectNoShow(id, req.user);
  }

  // Declared before ':id' so the literal segment wins.
  @Delete('noshow/:id')
  async approveNoShow(@Req() req: any, @Param('id') id: string) {
    const r = await this.bookingsService.approveNoShow(id, req.user);
    if ((r as any).error) {
      throw new HttpException({ message: 'Booking could not be deleted!' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return r;
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const r = await this.bookingsService.remove(id, req.user);
    if ((r as any).error) {
      throw new HttpException({ message: 'Booking could not be deleted!' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return r;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_BOOKINGS')
  @Get(':id/:status')
  async single(@Req() req: any, @Param('id') id: string, @Param('status') status: string) {
    const resource = await this.bookingsService.single(id, status, this.perms(req), req.user);
    if ((resource as any).notFound) {
      throw new HttpException({ message: 'Bookings does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }
}
