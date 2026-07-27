import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerPropertiesService } from './customer-properties.service';
import { UserAuthGuard } from '../auth/guards/user-auth.guard';
import { CountryAwareRequest } from '../../../common/middleware/country-selection.middleware';
import { PropertyDetailDto, PropertySearchDto } from './dto/customer-properties.dto';

// Re-exported so existing imports from the controller keep working.
export { PropertySearchDto, PropertyDetailDto };

/** P1–P4 — legacy `controllers/api/v2/properties.js`, mounted at `/api/properties`. */
@ApiTags('customer: properties')
@Controller('properties')
export class CustomerPropertiesController {
  constructor(private readonly propertiesService: CustomerPropertiesService) {}

  /** P1 — token probe; the guard is the whole handler. */
  @Post('authorized')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  authorized() {
    return {};
  }

  // `search` and `filters` are declared before `:id` so they are not swallowed by it.
  @Post('search')
  @HttpCode(200)
  search(@Body() body: PropertySearchDto, @Req() req: CountryAwareRequest) {
    return this.propertiesService.search(body, req.timezone);
  }

  @Get('filters')
  filters() {
    return this.propertiesService.filters();
  }

  /** P4 — detail; POST because the stay parameters travel in the body. */
  @Post(':id')
  @HttpCode(200)
  detail(
    @Param('id') id: string,
    @Body() body: PropertyDetailDto,
    @Req() req: CountryAwareRequest,
  ) {
    return this.propertiesService.detail(id, body, req.timezone);
  }
}
