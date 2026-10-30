import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Le build sort dans dist/web : Express le sert sous /app, et le paquet de déploiement (dist + node_modules) l'emporte.
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
    // CSP stricte : aucune ressource inlinée en data: URI (img-src et font-src restent 'self').
    assetsInlineLimit: 0,
  },
  // `npm run dev` : l'API reste servie par Express (npm run dev à la racine, port 3000).
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
