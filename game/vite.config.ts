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
    // Rapier ships its WASM inlined as base64 (~2 MB); it gets its own long-cacheable chunk.
    chunkSizeWarningLimit: 2600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/, priority: 3 },
            { name: 'three', test: /node_modules[\\/](three|three-stdlib|@react-three)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
});
