import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiUrl  = env.VITE_API_URL ?? 'http://localhost:4000';
  const port    = parseInt(env.PORT ?? '5173', 10);

  return {
    plugins: [react()],
    server: {
      port,
      host: true,   // listen on 0.0.0.0 so LAN devices can reach it
    },
    preview: {
      port,
      host: true,
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
  };
});
