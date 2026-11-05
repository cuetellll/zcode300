/**
 * Minimal structured logger with secret redaction. Never log raw tokens,
 * API keys, cookies or signed URLs.
 */

const SENSITIVE_KEY_PATTERN = /secret|token|password|authorization|cookie|key|credential|url/i;

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') {
    // Signed/livekit URLs contain credentials in query strings.
    return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      output[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : redactValue(v, depth + 1);
    }
    return output;
  }
  return value;
}

function write(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: 'mahyar-gap',
    message,
  };
  if (meta !== undefined) entry.meta = redactValue(meta);
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
