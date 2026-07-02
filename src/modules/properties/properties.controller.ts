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
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { PropertiesService } from './properties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import {
  propertyDocsUpload,
  nearbyUpload,
  photosUpload,
  PROPERTY_DOC_FIELDS,
} from './upload.config';

/**
 * Port of stayhopper/admin/controllers/v2/properties.js -> /admin/v2/properties
 * All routes require an authenticated administrator with LIST_PROPERTIES; owner scoping
 * (LIST_ALL_PROPERTIES vs LIST_OWN_PROPERTIES) and MANAGE_AGREEMENT are applied in the service.
 *
 * NOTE on request bodies: create/modify accept the raw (loose) body via `@Body() any` so
 * the global whitelist ValidationPipe doesn't strip the large nested property payload.
 * When files are attached the request is multipart; otherwise JSON is expected.
 */
@Controller('properties')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('LIST_PROPERTIES')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  private perms(req: any): string[] {
    return req.user?.role?.permissions || [];
  }

  @Get()
  list(@Req() req: any, @Query() query: any) {
    return this.propertiesService.list(query, req.user, this.perms(req));
  }

  // Declared before ':id' so the literal path wins.
  @Get('has-agreement-signed')
  hasAgreementSigned(@Req() req: any) {
    return this.propertiesService.hasAgreementSigned(req.user, this.perms(req));
  }

  // audit A5: req.user passed through so the service can owner-scope by-id operations.
  @Get(':id')
  async single(@Req() req: any, @Param('id') id: string) {
    const resource = await this.propertiesService.single(id, req.user);
    if (resource && (resource as any).notFound) {
      throw new HttpException({ message: 'Property does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @Post()
  @UseInterceptors(FileFieldsInterceptor(PROPERTY_DOC_FIELDS, propertyDocsUpload))
  create(@Req() req: any, @Body() body: any, @UploadedFiles() files: any) {
    return this.propertiesService.create(body, files, this.perms(req));
  }

  @Put(':id')
  @UseInterceptors(FileFieldsInterceptor(PROPERTY_DOC_FIELDS, propertyDocsUpload))
  async modify(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFiles() files: any,
  ) {
    const resource = await this.propertiesService.modify(id, body, files, this.perms(req), req.user);
    if (!resource) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.propertiesService.remove(id, req.user); // audit A5
  }

  // ---- Nearby ----
  @Post(':id/nearby')
  @UseInterceptors(FilesInterceptor('image', 10, nearbyUpload))
  async createNearby(
    @Req() req: any,
    @Param('id') id: string,
    @Body('name') name: string,
    @UploadedFiles() files: any[],
  ) {
    const result = await this.propertiesService.createNearby(id, name, files?.[0], req.user);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Property does not exist' }, HttpStatus.NOT_FOUND);
    }
    if ((result as any).badRequest) {
      return { status: 0, message: (result as any).message };
    }
    return (result as any).record;
  }

  @Delete(':id/nearby/:nearbyId')
  async removeNearby(@Req() req: any, @Param('id') id: string, @Param('nearbyId') nearbyId: string) {
    const result = await this.propertiesService.removeNearby(id, nearbyId, req.user);
    if ((result as any).badRequest) {
      throw new HttpException(
        { message: (result as any).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return (result as any).resource;
  }

  // ---- Photos ----
  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('file', 10, photosUpload))
  async createPhoto(@Req() req: any, @Param('id') id: string, @UploadedFiles() files: any[]) {
    const result = await this.propertiesService.createPhoto(id, files?.[0], req.user);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Post(':id/photos/feature')
  async featurePhoto(@Req() req: any, @Param('id') id: string, @Body('image') image: string) {
    const result = await this.propertiesService.featurePhoto(id, image, req.user);
    if ((result as any).notFound) {
      throw new HttpException(
        { message: 'Sorry, there was an error in performing this action' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return result;
  }

  // POST (not DELETE): the image URL is sent in the body.
  @Post(':id/photos/remove')
  async removePhoto(@Req() req: any, @Param('id') id: string, @Body('image') image: string) {
    const result = await this.propertiesService.removePhoto(id, image, req.user);
    if ((result as any).notFound) {
      throw new HttpException({ message: 'Resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return result;
  }
}
