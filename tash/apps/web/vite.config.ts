import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Set BASE_PATH=/tash/ to serve the app under a sub-path (nginx strips the prefix).
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Tash — Call Bridge, 29, Hazari',
        short_name: 'Tash',
        description: 'Call Bridge, Twenty-nine and Hazari with friends or bots.',
        theme_color: '#0f1320',
        background_color: '#0f1320',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/\/socket\.io/, /\/health$/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          motion: ['motion', '@dnd-kit/core'],
          net: ['socket.io-client'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
