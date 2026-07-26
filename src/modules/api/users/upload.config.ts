import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

/** 5 MB — a profile picture; legacy had no cap at all. */
export const USER_PIC_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * `POST /api/users/editprofile` avatar upload — same destination and filename scheme
 * as legacy `controllers/api/v2/users.js:355` (`public/files/userpics`,
 * `<field>-<timestamp><ext>`).
 *
 * MIGRATION.md 2g#5: legacy passed no `fileFilter` and no `limits`, so any file of any
 * size could be written to the public directory. Restricted to images with a size cap;
 * the success response shape is unchanged.
 */
export const userPicUpload = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir('public/files/userpics')),
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || '').toLowerCase();
      cb(null, `${file.fieldname}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: USER_PIC_MAX_BYTES, files: 1 },
  fileFilter: (
    _req: any,
    file: Express.Multer.File,
    cb: (err: any, ok: boolean) => void,
  ) => {
    const ext = (extname(file.originalname) || '').toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext) || !file.mimetype.startsWith('image/')) {
      return cb(new BadRequestException('Only images are allowed'), false);
    }
    cb(null, true);
  },
};
