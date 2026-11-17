import { defineConfig } from 'vite';

export default defineConfig({
  // Served at games.polinkhan.com/ludo/ (nginx strips the prefix). Override with BASE_PATH=/ for other hosts.
  base: process.env.BASE_PATH ?? '/ludo/',
  server: {
    port: 5174,
    host: true,
    proxy: { '/ludo/socket.io': { target: 'http://localhost:3003', ws: true, rewrite: (p) => p.replace(/^\/ludo/, '') } },
  },
});
