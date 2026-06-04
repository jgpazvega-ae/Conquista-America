import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages sirve desde /Conquista-America/ — rutas relativas funcionan en ambos entornos
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Asegura que los chunks estén en el mismo directorio que el HTML
    assetsDir: 'assets',
  },
});
