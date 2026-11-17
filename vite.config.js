import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// Dos páginas: el globo (index.html) y la lista de países (paises.html)
export default defineConfig(({ command, mode }) => {
  // Aviso claro en el log del build (p. ej. en Vercel) si falta la URL de Convex: sin ella la
  // clasificación online queda desactivada en la web publicada
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  if (command === 'build') {
    if (!env.VITE_CONVEX_URL) {
      console.warn(
        '\n⚠️  VITE_CONVEX_URL no está definida: la clasificación online quedará DESACTIVADA en este build.\n' +
          "   En Vercel, usa como Build Command: npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'\n"
      );
    } else {
      // Se muestra siempre a qué backend de Convex queda conectada la web, para detectar a la
      // vista si un build de producción apunta al despliegue de desarrollo
      console.log(`\nClasificación online conectada a: ${env.VITE_CONVEX_URL}\n`);
    }
  }
  return config;
});

const config = {
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        paises: resolve(import.meta.dirname, 'paises.html'),
      },
    },
  },
};
