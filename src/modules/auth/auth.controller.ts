import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { AutoLoginDto } from './dto/auto-login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * Port of stayhopper/admin/controllers/v2/auth.js
 * Mounted under the global prefix -> /admin/v2/auth/*
 * (Note: one-off /migrate-* maintenance routes from the legacy file are intentionally
 *  omitted; they were data backfills, not part of the live API.)
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('ping')
  ping() {
    return { status: 1, message: 'Ping success' };
  }

  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('login')
  login(@Req() req: any) {
    return this.authService.buildLoginResponse(req.user);
  }

  @HttpCode(200)
  @Post('auto-login')
  autoLogin(@Body() dto: AutoLoginDto) {
    return this.authService.autoLogin(dto.email, dto.autoLoginCode);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('authorized')
  authorized() {
    return {};
  }

  @HttpCode(200)
  @Post('logout')
  logout() {
    return {};
  }

  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user._id.toString(),
      dto.old_password,
      dto.new_password,
      dto.confirm_password,
    );
  }
}
