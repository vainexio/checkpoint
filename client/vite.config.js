import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * The libraries in their own files, which change far less often than
         * the app: a deploy then re-downloads the app code, not the map and
         * animation libraries with it. They are still loaded up front and
         * listed in index.html, so the offline shell (public/sw.js) picks
         * them up without knowing about this split.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          map: ['leaflet', 'react-leaflet'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Keeps development on one origin too, so /api behaves exactly as it will
    // in production and there is no CORS anywhere.
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? '4000'}`, changeOrigin: true },
    },
  },
});
