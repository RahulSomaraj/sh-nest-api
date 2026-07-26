import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Types } from 'mongoose';
import { CustomerUsersService } from './customer-users.service';
import { userPicUpload } from './upload.config';
import {
  ChangePasswordDto,
  CheckLoginDto,
  CustomerLoginDto,
  EditProfileDto,
  FavoritesDto,
  FbLoginDto,
  GuestUserDto,
  NotifyCredDto,
  RegisterUserDto,
  ResetPasswordDto,
} from './dto/customer-users.dto';
import {
  UserAuthGuard,
  UserLocalAuthGuard,
} from '../auth/guards/user-auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { UserDocument } from '../../users/schemas/user.schema';

/** U1–U14 — legacy `controllers/api/v2/users.js`, mounted at `/api/users`. */
@ApiTags('customer: users')
@Controller('users')
export class CustomerUsersController {
  constructor(private readonly usersService: CustomerUsersService) {}

  @Post()
  async register(
    @Body() body: RegisterUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.register(body);
    res.status(result.httpStatus);
    return result.body;
  }

  @Post('checklogin')
  @HttpCode(200)
  checkLogin(@Body() body: CheckLoginDto) {
    return this.usersService.checkLogin(body.username, body.password);
  }

  @Post('login')
  @UseGuards(UserLocalAuthGuard)
  async login(
    @CurrentUser() user: UserDocument,
    @Body() _body: CustomerLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.login(user);
    res.status(result.httpStatus);
    return result.body;
  }

  /** U4 — a bare "is this token still good?" probe; the guard is the whole handler. */
  @Post('authorized')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  authorized() {
    return {};
  }

  @Get('me')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  me(@CurrentUser() user: UserDocument) {
    return { user };
  }

  /** U6 — GET (not POST) in legacy; sh-website calls it as a GET. */
  @Get('logout')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  logout(@CurrentUser('_id') userId: Types.ObjectId) {
    return this.usersService.logout(userId);
  }

  @Post('reset-password')
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.resetPassword(body.email);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get('bookings')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  bookings(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Query('type') type?: string,
  ) {
    return this.usersService.bookings(userId, type);
  }

  @Post('editprofile')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'image', maxCount: 1 }], userPicUpload),
  )
  editProfile(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: EditProfileDto,
    @UploadedFiles() files?: { image?: Express.Multer.File[] },
  ) {
    return this.usersService.editProfile(userId, body, files?.image?.[0]?.path);
  }

  @Delete('delete-account')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  async deleteAccount(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.deleteAccount(userId);
    res.status(result.httpStatus);
    return result.body;
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  changePassword(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(userId, body.newpassword);
  }

  @Post('fb-login')
  @HttpCode(200)
  fbLogin(@Body() body: FbLoginDto) {
    return this.usersService.fbLogin(body);
  }

  @Post('notify_cred')
  @HttpCode(200)
  notifyCred(@Body() body: NotifyCredDto) {
    return this.usersService.notifyCred(body);
  }

  @Post('favorites')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('JWT')
  async favorites(
    @CurrentUser('_id') userId: Types.ObjectId,
    @Body() body: FavoritesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.toggleFavorite(userId, body.propertyId);
    res.status(result.httpStatus);
    return result.body;
  }
}

/**
 * U15/U16 — legacy `controllers/api/v3/guestUser.js`, mounted at `/api/v3` by
 * `routes/api.js:57`.
 */
@ApiTags('customer: users')
@Controller('v3')
export class GuestUserController {
  constructor(private readonly usersService: CustomerUsersService) {}

  @Post('guestUser')
  async guestUser(
    @Body() body: GuestUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.guestUser(body.email);
    res.status(result.httpStatus);
    return result.body;
  }

  @Post('checkIsGuestUser')
  async checkIsGuestUser(
    @Body() body: GuestUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.checkIsGuestUser(body.email);
    res.status(result.httpStatus);
    return result.body;
  }
}
