import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/local-engine': {
        target: 'http://localhost:8095',
        changeOrigin: true,
      },
      '/cabt-artifacts': {
        target: 'http://localhost:8765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cabt-artifacts/, ''),
      },
    },
  },
});
