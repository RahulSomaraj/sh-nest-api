import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRatingsService } from './user-ratings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';

/**
 * Port of stayhopper/admin/controllers/v2/user-ratings.js -> /admin/v2/user-ratings
 * All routes require an authenticated administrator with LIST_USER_RATINGS.
 */
@Controller('user-ratings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_USER_RATINGS')
export class UserRatingsController {
  constructor(private readonly userRatingsService: UserRatingsService) {}

  @Get()
  list(@Req() req: any, @Query() query: any) {
    const permissions: string[] = req.user?.role?.permissions || [];
    const hasPropertiesAccess = permissions.indexOf('LIST_ALL_PROPERTIES') > -1;
    return this.userRatingsService.list(query, hasPropertiesAccess);
  }

  @Put(':id/approval/:status')
  async approval(@Param('id') id: string, @Param('status') status: string) {
    const resource = await this.userRatingsService.approval(id, status);
    if (!resource) {
      throw new HttpException(
        { message: 'Sorry, resource does not exist' },
        HttpStatus.NOT_FOUND,
      );
    }
    return resource;
  }
}
