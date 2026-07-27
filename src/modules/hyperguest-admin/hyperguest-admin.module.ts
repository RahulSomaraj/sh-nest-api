import { Controller, Get, Module, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { HyperGuestModule } from '../api/hyperguest/hyperguest.module';
import { HyperGuestSyncService } from '../api/hyperguest/hyperguest-sync.service';

/**
 * Admin surface for the HyperGuest integration (mounted under admin/v2 via
 * AppModule's adminModules — HYPERGUEST_PLAN.md slab B).
 *
 * POST /admin/v2/hyperguest/sync — force a static sync without waiting for the
 * 6-hourly cron (same pattern as POST /admin/v2/invoices/generate). Returns the
 * run summary. With HG_ENABLED off it returns {skipped} and touches nothing.
 * GET  /admin/v2/hyperguest/sync-runs — recent run summaries for ops visibility.
 */
@Controller('hyperguest')
@UseGuards(JwtAuthGuard)
export class HyperGuestAdminController {
  constructor(private readonly sync: HyperGuestSyncService) {}

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_ALL_PROPERTIES')
  @Post('sync')
  trigger() {
    return this.sync.syncHotels('manual');
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('LIST_ALL_PROPERTIES')
  @Get('sync-runs')
  runs(@Query('limit') limit?: string) {
    return this.sync.recentRuns(Math.min(parseInt(limit, 10) || 10, 50));
  }
}

@Module({
  imports: [HyperGuestModule],
  controllers: [HyperGuestAdminController],
})
export class HyperGuestAdminModule {}
