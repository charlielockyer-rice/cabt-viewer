import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The svelte plugin + browser resolve conditions serve the DOM-mounted
  // component tests (per-file `@vitest-environment happy-dom` pragma);
  // node tests never import .svelte files and are unaffected.
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Polyfills the Web Animations API for happy-dom component tests; no-op in
    // the node environment. Keeps uncaught FLIP-animation errors from poisoning
    // the run's exit code.
    setupFiles: ['src/test-setup/dom-web-animations.ts'],
    testTimeout: 30_000,
  },
});
