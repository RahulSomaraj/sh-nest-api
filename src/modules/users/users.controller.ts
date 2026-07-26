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
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Port of stayhopper/admin/controllers/v2/users.js -> /admin/v2/users
 * Live routes: GET /, POST /, GET /:id, PUT /:id, DELETE /:id.
 * (Legacy POST create was commented out in the source; re-added to serve the sh-account
 * user-create form. Mirrors administrators.create(): password generated + hashed server-side.)
 * All routes require an authenticated administrator with LIST_USERS.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_USERS')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: any) {
    return this.usersService.list(query);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create({ ...dto });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const resource = await this.usersService.getById(id);
    if (resource && (resource as any).notFound) {
      throw new HttpException(
        { message: 'Resource does not exist' },
        HttpStatus.NOT_FOUND,
      );
    }
    return resource;
  }

  @Put(':id')
  async modify(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const resource = await this.usersService.modify(id, { ...dto });
    if (!resource) {
      throw new HttpException(
        { message: 'Sorry, resource does not exist' },
        HttpStatus.NOT_FOUND,
      );
    }
    return resource;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
