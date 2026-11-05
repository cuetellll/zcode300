import { HttpError } from './errors';

/**
 * Avatars are stored as data URLs in PostgreSQL (small images only).
 * Validate declared MIME, decoded size and magic bytes — never trust the client.
 */
const MAX_AVATAR_BYTES = 262_144; // 256 KiB

const MAGIC_BYTES: Array<{ mime: string; test: (bytes: Uint8Array) => boolean }> = [
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

export function validateAvatarDataUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid avatar');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new HttpError(400, 'Avatar must be a base64 PNG, JPEG or WebP data URL');
  const mime = match[1];
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    throw new HttpError(400, 'Avatar data is not valid base64');
  }
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
    throw new HttpError(400, 'Avatar must be between 1 byte and 256 KiB');
  }
  const magic = MAGIC_BYTES.find((entry) => entry.mime === mime);
  if (!magic || !magic.test(bytes.subarray(0, 12))) {
    throw new HttpError(400, 'Avatar file content does not match its declared type');
  }
  return `data:${mime};base64,${match[2].replace(/\s+/g, '')}`;
}
