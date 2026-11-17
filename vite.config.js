import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Dos páginas: el globo (index.html) y la lista de países (paises.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        paises: resolve(import.meta.dirname, 'paises.html'),
      },
    },
  },
});
