import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

/** Parse a boolean-ish env value without z.coerce.boolean's "false"->true trap. */
const booleanEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  CORS_ORIGIN: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  // Railway S3-compatible bucket (chat attachments)
  AWS_ENDPOINT_URL: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().optional(),
  AWS_DEFAULT_REGION: z.string().optional(),
  AWS_S3_URL_STYLE: z.string().optional(),

  // Mahyar Radio
  RADIO_ENABLED: booleanEnv(true),
  RADIO_IDLE_SHUTDOWN_MS: z.coerce.number().int().min(5000).default(30_000),
  RADIO_MAX_ACTIVE_ROOMS: z.coerce.number().int().min(1).max(50).default(1),
  RADIO_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(45_000),
  RADIO_WORKER_PYTHON: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & {
  isProduction: boolean;
  jwtSecret: string;
};

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  let jwtSecret = value.JWT_ACCESS_SECRET ?? '';
  if (!jwtSecret) {
    if (isProduction) {
      throw new Error('JWT_ACCESS_SECRET is required in production (min 32 chars).');
    }
    jwtSecret = 'local-development-only-secret-change-before-deploy';
  }

  return {
    ...value,
    JWT_ACCESS_SECRET: jwtSecret,
    isProduction,
    jwtSecret,
  };
}

export const env = loadEnv();

/** Absolute path to the radio worker entry (python). */
export function radioWorkerEntry(): string {
  // apps/api/dist/config/env.js -> repo root is three levels up in production,
  // two levels up when running from src via tsx.
  const candidates = [
    path.resolve(__dirname, '../../../workers/radio/main.py'),
    path.resolve(__dirname, '../../../../workers/radio/main.py'),
    path.resolve(process.cwd(), 'workers/radio/main.py'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/** Preferred python interpreter for the radio worker (bundled venv first). */
export function radioWorkerPython(): string {
  if (env.RADIO_WORKER_PYTHON) return env.RADIO_WORKER_PYTHON;
  const bundled = '/opt/radio-venv/bin/python';
  if (fs.existsSync(bundled)) return bundled;
  return 'python3';
}
