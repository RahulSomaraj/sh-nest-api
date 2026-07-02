import {
  Body,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { BaseCrudService } from './base-crud.service';
import { crudImageUpload } from './crud-upload.config';

/**
 * Decorated base for standard-CRUD controllers. Concrete controllers only add
 * `@Controller('<route>')` and inject their service. Matches legacy auth model:
 * list is open to any authenticated admin; single/create/modify/remove require
 * SHOW_SETTINGS. Bodies are raw (`@Body() any`) to preserve arbitrary fields past the
 * global whitelist pipe; an optional `image` upload is wired for resources that use it.
 *
 * Guards are applied at method level: NestJS does not reliably inherit class-level guard
 * metadata onto subclasses, but method decorators live on the inherited method functions.
 */
export abstract class BaseCrudController {
  protected constructor(protected readonly service: BaseCrudService) {}

  private notFoundTitle(): string {
    return (this.service as any)?.options?.moduleTitle || 'Resource';
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('SHOW_SETTINGS')
  @Get(':id')
  async single(@Param('id') id: string) {
    const resource = await this.service.single(id);
    if ((resource as any).notFound) {
      throw new HttpException({ message: `${this.notFoundTitle()} does not exist` }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('SHOW_SETTINGS')
  @Post()
  @UseInterceptors(FilesInterceptor('image', 10, crudImageUpload))
  create(@Body() body: any, @UploadedFiles() files: any[]) {
    return this.service.create(body, files?.[0]);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('SHOW_SETTINGS')
  @Put(':id')
  @UseInterceptors(FilesInterceptor('image', 10, crudImageUpload))
  async modify(@Param('id') id: string, @Body() body: any, @UploadedFiles() files: any[]) {
    const resource = await this.service.modify(id, body, files?.[0]);
    if (!resource) {
      throw new HttpException({ message: 'Sorry, resource does not exist' }, HttpStatus.NOT_FOUND);
    }
    return resource;
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('SHOW_SETTINGS')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
