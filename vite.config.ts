import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        flip: resolve(__dirname, 'flipimage.html'),
        diff: resolve(__dirname, 'difimage.html'),
        sudoku: resolve(__dirname, 'sudokusolver.html'),
        treasure: resolve(__dirname, 'treasuremap.html'),
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
