import {
  Controller,
  Delete,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiUsageService } from './api-usage.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
// import { PermissionsGuard } from '../auth/permissions.guard';
// import { RequirePermissions } from '../auth/permissions.decorator';

/**
 * Audit endpoints for API usage. Authenticated admins only.
 *
 * Hardening option: add PermissionsGuard + @RequirePermissions('SHOW_SETTINGS')
 * (or a dedicated permission) if this should be limited to super admins.
 *
 *   GET    /admin/v2/api-usage           full report (least-used first; ?order=desc to flip)
 *   GET    /admin/v2/api-usage/unused    only endpoints never hit (count === 0)
 *   DELETE /admin/v2/api-usage           reset all counters (start a fresh window)
 */
@Controller('api-usage')
@UseGuards(JwtAuthGuard)
export class ApiUsageController {
  constructor(private readonly service: ApiUsageService) {}

  @Get()
  report(@Query() query: any) {
    return this.service.report(query);
  }

  @Get('unused')
  unused() {
    return this.service.unused();
  }

  @Delete()
  reset() {
    return this.service.reset();
  }
}
