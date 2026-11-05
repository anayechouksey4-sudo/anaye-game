import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': sharedDir },
  },
  server: {
    host: true,
    // The wire protocol lives outside this package (../shared) and is imported as source.
    fs: { allow: ['.', sharedDir] },
  },
  preview: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
