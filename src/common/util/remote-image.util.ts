import { Logger } from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const logger = new Logger('RemoteImage');

/** Cap on a downloaded avatar. Anything larger is discarded mid-stream. */
export const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Download a remote image to `destPath`.
 *
 * MIGRATION.md 2g#6: legacy `fb-login` did `request(image_link).pipe(fs.createWriteStream(...))`
 * with a caller-supplied URL and no checks at all — an SSRF sink that would happily write
 * an HTML page, an internal-network response, or an unbounded body to the public dir.
 * This keeps the same observable behaviour (file at `destPath`, failures ignored) while
 * requiring http(s), a non-loopback host, an `image/*` content type and a size cap.
 *
 * Returns true when a file was written.
 */
export async function downloadImage(
  url: string,
  destPath: string,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn('Rejected avatar download: unparseable URL');
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    logger.warn(`Rejected avatar download: protocol ${parsed.protocol}`);
    return false;
  }
  if (isPrivateHost(parsed.hostname)) {
    logger.warn('Rejected avatar download: private/loopback host');
    return false;
  }

  try {
    const response = await fetch(parsed.toString(), { redirect: 'follow' });
    if (!response.ok || !response.body) {
      logger.warn(`Avatar download failed: HTTP ${response.status}`);
      return false;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      logger.warn(`Rejected avatar download: content-type ${contentType}`);
      return false;
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) {
      logger.warn('Rejected avatar download: content-length over cap');
      return false;
    }

    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let written = 0;
    const capped = new Readable({ read() {} });
    const reader = response.body.getReader();
    // Pump manually so the transfer can be aborted the moment the cap is exceeded,
    // rather than after an unbounded body has already landed on disk.
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          written += value.byteLength;
          if (written > maxBytes) {
            capped.destroy(new Error('Remote image exceeded size cap'));
            await reader.cancel();
            return;
          }
          capped.push(Buffer.from(value));
        }
        capped.push(null);
      } catch (e) {
        capped.destroy(e as Error);
      }
    })();

    await pipeline(capped, createWriteStream(destPath));
    return true;
  } catch (e) {
    logger.warn(`Avatar download failed: ${e}`);
    // A partial file is worse than none — the caller would advertise a broken image.
    try {
      if (existsSync(destPath)) unlinkSync(destPath);
    } catch {
      /* best effort */
    }
    return false;
  }
}

/** Block loopback / link-local / RFC1918 targets so the URL cannot reach internal services. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}
