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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RoomsService } from './rooms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { roomPhotosUpload } from './upload.config';

/**
 * Port of stayhopper/admin/controllers/v2/rooms.js -> /admin/v2/rooms
 * All routes require an authenticated administrator with LIST_ROOMS.
 * Bodies for create/modify/rates are accepted raw (@Body() any) to preserve the nested
 * rate payloads past the global whitelist pipe.
 */
@Controller('rooms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_ROOMS')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  list(@Query() query: any) {
    return this.roomsService.list(query);
  }

  @Get(':id')
  async single(@Param('id') id: string) {
    const resource = await this.roomsService.single(id);
    if ((resource as any).notFound) {
      throw new HttpException({ message: 'Room does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @Post()
  @UseInterceptors(FilesInterceptor('file', 10, roomPhotosUpload))
  create(@Body() body: any) {
    return this.roomsService.create(body);
  }

  @Put(':id')
  @UseInterceptors(FilesInterceptor('file', 10, roomPhotosUpload))
  async modify(@Param('id') id: string, @Body() body: any) {
    const resource = await this.roomsService.modify(id, body);
    if (!resource) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }

  // ---- Rates ----
  @Post(':id/rates')
  @UseInterceptors(FilesInterceptor('file', 10, roomPhotosUpload))
  async createRate(@Param('id') id: string, @Body() body: any) {
    const rate = await this.roomsService.createRate(id, body);
    if (!rate) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return rate;
  }

  @Put(':id/rates/:rateId')
  @UseInterceptors(FilesInterceptor('file', 10, roomPhotosUpload))
  async modifyRate(
    @Req() req: any,
    @Param('id') id: string,
    @Param('rateId') rateId: string,
    @Body() body: any,
  ) {
    const rate = await this.roomsService.modifyRate(id, rateId, req.user._id.toString(), body);
    if (!rate) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return rate;
  }

  @Delete(':id/rates/:rateId')
  async removeRate(@Param('id') id: string, @Param('rateId') rateId: string) {
    const resource = await this.roomsService.removeRate(id, rateId);
    if (!resource) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  // ---- Availability ----
  @Get(':id/availability')
  async listAvailability(@Param('id') id: string, @Query('date') date: string) {
    const result = await this.roomsService.listAvailability(id, date);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Room does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Post(':id/availability/:action')
  changeAvailability(@Param('action') action: string, @Body() body: any) {
    return this.roomsService.changeAvailability(action, body);
  }

  // ---- Photos ----
  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('file', 10, roomPhotosUpload))
  async createPhoto(@Param('id') id: string, @UploadedFiles() files: any[]) {
    const result = await this.roomsService.createPhoto(id, files?.[0]);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Post(':id/photos/feature')
  featurePhoto(@Param('id') id: string, @Body('image') image: string) {
    return this.roomsService.featurePhoto(id, image);
  }

  @Post(':id/photos/remove')
  async removePhoto(@Param('id') id: string, @Body('image') image: string) {
    const result = await this.roomsService.removePhoto(id, image);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }
}
