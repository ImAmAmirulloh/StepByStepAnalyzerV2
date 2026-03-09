import {defineConfig} from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        flip: 'flipimage.html',
        diff: 'difimage.html',
        sudoku: 'sudokusolver.html',
        treasure: 'treasuremap.html'
      }
    }
  }
});
