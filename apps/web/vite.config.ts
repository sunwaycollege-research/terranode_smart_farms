import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TERANODE web admin (Vite + React 18 + TS).
// VITE_API_URL defaults to the local API; override via env for other targets.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
  },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL ?? 'http://localhost:4000',
    ),
  },
});
