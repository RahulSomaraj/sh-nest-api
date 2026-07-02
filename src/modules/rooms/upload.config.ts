import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

// Room photos uploaded full-size here, then resized into public/files/rooms (see service).
export const roomPhotosUpload = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir('public/files/original/rooms')),
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || '').toLowerCase();
      cb(null, `${file.fieldname}-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: (e: any, ok: boolean) => void) => {
    const ext = (extname(file.originalname) || '').toLowerCase();
    const allowed = ['.svg', '.png', '.jpg', '.gif', '.jpeg', '.webp'];
    if (!allowed.includes(ext)) return cb(new BadRequestException('Only images are allowed'), false);
    cb(null, true);
  },
};
