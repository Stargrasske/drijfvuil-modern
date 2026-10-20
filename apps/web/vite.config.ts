import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localDemoConfiguration } from '../../libs/runtime/src/local-ports.js';

export function createWebConfig(environment: Readonly<Record<string, string | undefined>>) {
  const { webPort, apiTarget } = localDemoConfiguration(environment);
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: {
        '/graphql': { target: apiTarget, changeOrigin: false },
        '/files': { target: apiTarget, changeOrigin: false },
        '/auth': { target: apiTarget, changeOrigin: false },
      },
    },
    build: {
      outDir: '../../dist/web',
      emptyOutDir: true,
    },
  };
}

export default defineConfig(() => createWebConfig(process.env));
