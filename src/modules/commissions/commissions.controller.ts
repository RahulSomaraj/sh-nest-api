import { Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Port of stayhopper/admin/controllers/v2/commissions.js -> /admin/v2/commissions
 * The legacy implementation returns hardcoded values (the feature is stubbed there too):
 *   GET  -> { commission: 2.6666666 }
 *   PUT  -> 400 { success: true }
 */
@Controller('commissions')
export class CommissionsController {
  @UseGuards(JwtAuthGuard)
  @Get()
  get() {
    return { commission: 2.6666666 };
  }

  // Legacy returns HTTP 400 with { success: true } (a quirk preserved for parity).
  @UseGuards(JwtAuthGuard)
  @HttpCode(400)
  @Put()
  edit() {
    return { success: true };
  }
}
