import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  // audit (auth hardening): tight per-endpoint throttle to blunt credential brute force.
  // _body is unused at runtime (LocalAuthGuard consumes username/password) but binding
  // the DTO documents the request body in Swagger and validates the payload shape.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('login')
  login(@Req() req: any, @Body() _body: LoginDto) {
    return this.authService.buildLoginResponse(req.user);
  }

  // audit (auth hardening): throttle auto-login token attempts.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  // audit (auth hardening): throttle to prevent reset-spam / email enumeration probing.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
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
