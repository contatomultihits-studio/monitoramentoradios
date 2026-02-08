import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // ISSO AQUI EVITA O ERRO DE USEREF E O SITE FECHAR:
      external: ['react', 'react-dom', 'react-dom/client', 'lucide-react', 'recharts', 'jspdf'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
