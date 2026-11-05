import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Response } from 'express';

/**
 * Generic S3-compatible storage helpers (Railway Storage Bucket).
 *
 * Used exclusively for chat attachments and avatars-as-files. This module is
 * the successor of the old server/music/storage.ts generic half; all
 * music-specific helpers were removed with the retired music subsystem.
 *
 * The bucket stays private: uploads stream through the API (no browser
 * presigned PUTs), downloads are authorized and streamed back. No access key
 * ever reaches the browser.
 */

export const STORAGE_ENV_VARS = {
  endpoint: 'AWS_ENDPOINT_URL',
  bucket: 'AWS_S3_BUCKET_NAME',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
} as const;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  ready: boolean;
}

export function storageConfig(): StorageConfig {
  const endpoint = (process.env.AWS_ENDPOINT_URL ?? '').trim().replace(/\/+$/, '');
  const bucket = (process.env.AWS_S3_BUCKET_NAME ?? '').trim();
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY ?? '').trim();
  const region = (process.env.AWS_DEFAULT_REGION ?? 'auto').trim() || 'auto';
  const urlStyle = (process.env.AWS_S3_URL_STYLE ?? '').trim().toLowerCase();
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: urlStyle.startsWith('path'),
    ready: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
  };
}

export function missingStorageVariables(): string[] {
  return Object.values(STORAGE_ENV_VARS).filter((name) => !(process.env[name] ?? '').trim());
}

type S3Client = unknown;
let cachedClient: { key: string; client: S3Client } | null = null;

async function client(): Promise<S3Client> {
  const config = storageConfig();
  if (!config.ready) throw new Error('Railway Bucket storage is not configured.');
  const key = [config.endpoint, config.region, config.bucket, config.accessKeyId, config.forcePathStyle].join('|');
  if (cachedClient?.key === key) return cachedClient.client;
  const { S3Client: Client } = await import('@aws-sdk/client-s3');
  const instance = new Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
    // Required for presign/host compat with Railway buckets.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  } as never);
  cachedClient = { key, client: instance };
  return instance;
}

/** Generate a collision-safe object key for an attachment upload. */
export function attachmentObjectKey(originalName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const tail = originalName
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-120) || 'file';
  return `${date}/${randomUUID()}-${tail}`;
}

/** Stream an incoming request body straight into the bucket (bounded by the caller). */
export async function putObjectStream(
  key: string,
  contentType: string,
  contentLength: number,
  body: Readable,
): Promise<void> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = (await client()) as { send: (command: unknown) => Promise<unknown> };
  await s3.send(
    new PutObjectCommand({
      Bucket: storageConfig().bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
  );
}

/** Stream a stored object to an authorized HTTP response. Returns false on 404. */
export async function streamObjectTo(key: string, res: Response): Promise<boolean> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = (await client()) as { send: (command: unknown) => Promise<unknown> };
  try {
    const result = (await s3.send(
      new GetObjectCommand({ Bucket: storageConfig().bucket, Key: key }),
    )) as { Body?: Readable & { pipe?: Readable['pipe'] }; ContentType?: string; ContentLength?: number };
    if (!result?.Body) return false;
    res.setHeader('Content-Type', result.ContentType ?? 'application/octet-stream');
    if (typeof result.ContentLength === 'number') res.setHeader('Content-Length', result.ContentLength);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const body = result.Body as Readable;
    body.pipe(res);
    return true;
  } catch (error) {
    const name = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code;
    if (name === 'NoSuchKey' || name === 'NotFound' || name === '404') return false;
    throw error;
  }
}

/** Best-effort object deletion (used when messages with attachments are removed). */
export async function deleteObject(key: string): Promise<void> {
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = (await client()) as { send: (command: unknown) => Promise<unknown> };
    await s3.send(new DeleteObjectCommand({ Bucket: storageConfig().bucket, Key: key }));
  } catch {
    // Swallow — cleanup is best-effort.
  }
}
