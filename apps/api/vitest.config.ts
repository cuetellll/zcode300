import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-1234',
      ACCESS_TOKEN_TTL_SECONDS: '900',
      LIVEKIT_URL: 'wss://test.livekit.cloud',
      LIVEKIT_API_KEY: 'APIKeyTest',
      LIVEKIT_API_SECRET: 'secret-test-value-0123456789abcdef',
      AWS_ENDPOINT_URL: '',
    },
  },
});
