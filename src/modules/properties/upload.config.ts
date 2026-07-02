import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

/** Ensure a destination directory exists before multer writes to it. */
const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const makeStorage = (dest: string) =>
  diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir(dest)),
    filename: (_req, file, cb) => {
      const ext = (extname(file.originalname) || '').toLowerCase();
      cb(null, `${file.fieldname.replace(/[[\]]/g, '_')}-${Date.now()}${ext}`);
    },
  });

const extensionFilter =
  (allowed: string[], message: string) =>
  (_req: any, file: Express.Multer.File, cb: (err: any, ok: boolean) => void) => {
    const ext = (extname(file.originalname) || '').toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new BadRequestException(message), false);
    }
    cb(null, true);
  };

// Property documents (trade licence / passport) — docs, PDFs, images.
export const propertyDocsUpload = {
  storage: makeStorage('public/files/properties'),
  fileFilter: extensionFilter(
    ['.docx', '.doc', '.pdf', '.svg', '.png', '.jpg', '.gif', '.jpeg', '.webp'],
    'Only documents, PDFs, or images are allowed',
  ),
};

export const nearbyUpload = {
  storage: makeStorage('public/img/nearby'),
  fileFilter: extensionFilter(
    ['.svg', '.png', '.jpg', '.gif', '.jpeg'],
    'Only images are allowed',
  ),
};

// Photos are uploaded at full size to the "original" dir, then resized (see service).
export const photosUpload = {
  storage: makeStorage('public/files/original/properties'),
  fileFilter: extensionFilter(
    ['.svg', '.png', '.jpg', '.gif', '.jpeg', '.webp'],
    'Only images are allowed',
  ),
};

export const PROPERTY_DOC_FIELDS = [
  { name: 'trade_licence[trade_licence_attachment]', maxCount: 1 },
  { name: 'trade_licence[passport_attachment]', maxCount: 1 },
];
