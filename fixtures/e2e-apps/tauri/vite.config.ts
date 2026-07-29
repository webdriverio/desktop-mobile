import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Use relative paths for assets
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        splash: resolve(__dirname, 'splash.html'),
        childWebview: resolve(__dirname, 'child-webview.html'),
      },
    },
  },
  // Ensure workspace packages are resolved correctly
  resolve: {
    preserveSymlinks: false,
  },
});
