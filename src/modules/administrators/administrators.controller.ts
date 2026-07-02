import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdministratorsService } from './administrators.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CreateAdministratorDto } from './dto/create-administrator.dto';
import { UpdateAdministratorDto } from './dto/update-administrator.dto';
import { OnboardingDto, OnboardingVerifyDto } from './dto/onboarding.dto';

/**
 * Port of stayhopper/admin/controllers/v2/administrators.js -> /admin/v2/administrators
 */
@Controller('administrators')
export class AdministratorsController {
  constructor(private readonly administratorsService: AdministratorsService) {}

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Get()
  list(@Query() query: any) {
    return this.administratorsService.list(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: any) {
    return this.administratorsService.getMe(req.user._id.toString());
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Get(':id')
  async getById(@Param('id') id: string) {
    const resource = await this.administratorsService.getById(id);
    if (resource && (resource as any).notFound) {
      throw new HttpException({ message: 'Resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Post()
  create(@Body() dto: CreateAdministratorDto) {
    return this.administratorsService.create({ ...dto });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Put(':id')
  async modify(@Param('id') id: string, @Body() dto: UpdateAdministratorDto) {
    const resource = await this.administratorsService.modify(id, { ...dto });
    if (!resource) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.administratorsService.remove(id);
  }

  // audit A2: re-exposed legacy hoteladmins POST /check_active_bookings so the frontend
  // can warn before a destructive delete. Same body/response contract ({status, count}).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('LIST_ADMINISTRATORS')
  @Post('check_active_bookings')
  checkActiveBookings(@Body() body: any) {
    return this.administratorsService.checkActiveBookings(body?.hoteladmin_id ?? body?.administrator_id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('send-welcome-email/:id')
  async sendWelcomeEmail(@Param('id') id: string) {
    const result = await this.administratorsService.sendWelcomeEmail(id);
    if (result.status === 200) {
      return { message: 'Email sent successfully!' };
    }
    if (result.status === 404) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    throw new HttpException(
      { message: 'Sorry, there was an error in performing this operation' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // Public onboarding routes (website-driven), no auth — matches legacy.
  @Post('onboarding')
  async onboarding(@Body() dto: OnboardingDto) {
    const result = await this.administratorsService.onboarding(dto);
    if (result.ok) {
      return { message: result.message };
    }
    throw new HttpException(
      { message: result.message, messageCode: (result as any).messageCode },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Post('onboarding/verify')
  async onboardingVerify(@Body() dto: OnboardingVerifyDto) {
    const result = await this.administratorsService.onboardingVerify(dto);
    if (result.ok) {
      return { message: result.message, extranetPropertyUrl: (result as any).extranetPropertyUrl };
    }
    throw new HttpException({ message: result.message }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
