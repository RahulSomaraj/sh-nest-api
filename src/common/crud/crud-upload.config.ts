import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

/**
 * Shared image upload for standard-CRUD resources. Destination folder is derived from the
 * mounted route (e.g. /admin/v2/countries -> public/img/countries), mirroring the legacy
 * per-resource `public/img/<resource>` directories.
 */
export const crudImageUpload = {
  storage: diskStorage({
    destination: (req: any, _file, cb) => {
      const seg = String(req.baseUrl || '').split('/').filter(Boolean).pop() || 'misc';
      const dir = `public/img/${seg}`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || '').toLowerCase();
      cb(null, `${file.fieldname}-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: (e: any, ok: boolean) => void) => {
    const ext = (extname(file.originalname) || '').toLowerCase();
    const allowed = ['.svg', '.png', '.jpg', '.gif', '.jpeg'];
    if (!allowed.includes(ext)) return cb(new BadRequestException('Only images are allowed'), false);
    cb(null, true);
  },
};
