import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: { port: 3000, host: '0.0.0.0' },
      plugins: [react()],
      build: {
        rollupOptions: {
          external: ['react', 'react-dom', 'react-dom/client', 'lucide-react', 'recharts', 'jspdf'],
        },
      },
      resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
      }
    };
});
