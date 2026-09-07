import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Matches this repo's GitHub Pages URL (https://sircharlo.github.io/sip-ahoy/).
// The service worker needs a real absolute base (not a relative "./") for a reliably-scoped
// cache — offline use with zero connectivity is the whole point of this app on a cruise ship.
const BASE = '/sip-ahoy/';

export default defineConfig({
  base: BASE,
  build: {
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sip Ahoy',
        short_name: 'Sip Ahoy',
        description: 'Search every bar & restaurant drink menu on a Princess cruise — works fully offline once installed.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f4f7fb',
        theme_color: '#0a5fb4',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the entire drink dataset + every menu photo (~22MB) so the app works with
        // zero connectivity once it's been opened once while on wifi.
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}', 'icons/*.png', 'data/**/*.{json,jpg,jpeg,webp,png}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
