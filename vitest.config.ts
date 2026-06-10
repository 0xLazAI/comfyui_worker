import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      COMFYUI_WORKER_PROJECTS_ROOT: '/data/pai-projects',
      COMFYUI_WORKER_TOKEN: 'demo-worker-token',
      PAI_PROJECTS_MOUNT_ROOT: '/data/pai-projects',
    },
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
