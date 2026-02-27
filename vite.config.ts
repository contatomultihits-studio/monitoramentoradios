import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html',
        musical: './musical.html',
        comercial: './comercial.html',
        login: './login.html',
        trocarSenha: './trocar-senha.html',
        gerenciamento: './gerenciamento.html'
      }
    }
  }
})
