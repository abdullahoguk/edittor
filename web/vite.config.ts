import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const api = 'http://127.0.0.1:' + (process.env.PORT ?? 5174);
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/media': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
});
