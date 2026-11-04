import { defineConfig } from 'vite';

// Server kantor lokal berjalan di 4500. Kalau /api tidak menjawab,
// halaman memakai cadangan data/contoh-state.json.
export default defineConfig({
  server: {
    port: 4600,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4500',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
