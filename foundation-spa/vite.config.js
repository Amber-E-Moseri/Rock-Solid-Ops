import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFixtureAlias } from './src/lib/devFlags.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode }) => {
  // Dev-server-only synthetic Supabase client (opt-in via VITE_PREVIEW_FIXTURES=true).
  // Builds never receive this alias, so the fixture module cannot reach production.
  const fixtureAlias = resolveFixtureAlias({ command, env: process.env }) === 'fixtures'
    ? [{ find: /^(?:\.{1,2}\/)+supabase\.js$/, replacement: path.join(here, 'src/dev/fixtureSupabase.js') }]
    : [];
  return {
    // Production base for the isolated /app/ publish build (scripts/build-spa-publish.mjs).
    // Defaults to '/' so dev and the standalone build are unchanged.
    base: process.env.SPA_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      // Custom hand-written service worker (src/sw.js) so the approved caching
      // boundaries are explicit rather than workbox-generated. injectManifest
      // replaces `self.__WB_MANIFEST` in that file with the hashed shell list.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['pwa-icon.svg', 'pwa-icon-maskable.svg'],
      manifest: {
        name: 'Rock Solid Ops',
        short_name: 'RSO',
        description: 'Foundation School internal staff operations platform.',
        start_url: '/app/',
        scope: '/app/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#4C2A92',
        background_color: '#f8f5ee',
        icons: [
          { src: '/app/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/app/pwa-icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
      // Serve the SW in `vite dev` so install + caching can be verified pre-build.
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5174,
    strictPort: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
  },
  resolve: {
    alias: [
      ...fixtureAlias,
      { find: '@', replacement: '/src' },
    ],
    dedupe: ['react', 'react-dom'],
  },
  };
});
