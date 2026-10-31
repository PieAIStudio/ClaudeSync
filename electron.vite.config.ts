import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { developmentCsp } from './electron/renderer-security';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'electron/preload.ts') },
        // Sandboxed preloads cannot use ESM, even when the app is an ES module.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), developmentCsp()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
});
