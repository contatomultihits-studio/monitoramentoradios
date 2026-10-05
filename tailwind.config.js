/** @type {import('tailwindcss').Config} */
// Antes o Tailwind era montado no navegador (cdn.tailwindcss.com) a cada abertura
// de página. Agora o CSS é gerado uma vez, na publicação, a partir destes arquivos.
export default {
  content: ['./*.html', './index.tsx'],
  theme: { extend: {} },
  plugins: [],
};
