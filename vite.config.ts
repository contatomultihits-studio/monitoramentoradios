import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          // AQUI ESTÁ O SEGREDO: 
          // Diz ao Vite para NÃO empacotar essas bibliotecas, 
          // pois o seu index.html já as carrega via ESM.sh
          external: [
            'react',
            'react-dom',
            'react-dom/client',
            'lucide-react',
            'recharts',
            'jspdf'
          ],
        },
      },
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
