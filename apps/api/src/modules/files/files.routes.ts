import { Router } from 'express';
import { asyncHandler, badRequest, HttpError, notFound } from '../../lib/errors';
import { getUserId, requireAuth } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rate-limit';
import { logger } from '../../lib/logger';
import {
  attachmentObjectKey,
  missingStorageVariables,
  putObjectStream,
  storageConfig,
  streamObjectTo,
} from '../../storage/s3';
import { isSafeObjectKey } from '../../lib/validators';

export const filesRouter = Router();

export const FILE_MAX_BYTES = 52_428_800; // 50 MiB

export const FILE_MIME_ALLOWLIST = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'application/pdf',
  'text/plain',
]);

filesRouter.post(
  '/upload',
  requireAuth,
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    if (!storageConfig().ready) {
      throw new HttpError(501, 'File storage is not configured on this deployment', 'FILE_STORAGE_NOT_CONFIGURED', {
        missing_variables: missingStorageVariables(),
      });
    }

    const rawName = String(req.query.name ?? 'file');
    if (rawName.length > 256) throw badRequest('File name is too long');
    const fileName = rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'file';
    const contentType = String(req.query.type ?? '').toLowerCase();
    if (!FILE_MIME_ALLOWLIST.has(contentType)) {
      throw new HttpError(415, `Content type is not allowed. Allowed: ${[...FILE_MIME_ALLOWLIST].join(', ')}`);
    }

    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (!contentLength) throw new HttpError(411, 'Content-Length header is required');
    if (contentLength > FILE_MAX_BYTES) {
      throw new HttpError(413, `File exceeds the ${Math.round(FILE_MAX_BYTES / 1024 / 1024)} MB limit`);
    }

    const key = attachmentObjectKey(fileName);
    await putObjectStream(key, contentType, contentLength, req);
    logger.info('attachment uploaded', { userId, size: contentLength, contentType });
    res.status(201).json({
      url: `/api/files/${key}`,
      key,
      name: fileName,
      content_type: contentType,
      size: contentLength,
    });
  }),
);

filesRouter.get(
  '/*',
  requireAuth,
  asyncHandler(async (req, res) => {
    const key = req.params[0] ?? '';
    if (!isSafeObjectKey(key)) throw badRequest('Invalid file path');
    if (!storageConfig().ready) {
      throw new HttpError(501, 'File storage is not configured on this deployment', 'FILE_STORAGE_NOT_CONFIGURED');
    }
    const found = await streamObjectTo(key, res);
    if (!found) throw notFound('File not found');
  }),
);
