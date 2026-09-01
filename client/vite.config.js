import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
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
