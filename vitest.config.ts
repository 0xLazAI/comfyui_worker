import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      COMFYUI_WORKER_PROJECTS_ROOT: '/data/pai-projects',
      COMFYUI_WORKER_TOKEN: 'demo-worker-token',
      PAI_PROJECTS_MOUNT_ROOT: '/data/pai-projects',
      // Run unit tests with the platform asset/PACE API disabled regardless of the
      // developer's .env, so the S3 asset path is exercised here and the platform-API
      // path by its own (mocked) tests.
      PAI_PLATFORM_API_BASE: '',
      // The GraphQL SDK reads this; keep it set so the enabled/disabled tests are
      // deterministic regardless of the developer's .env.
      PAI_PLATFORM_GRAPH: 'https://pai-api-test.lazai.io/api/graphql/',
    },
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
