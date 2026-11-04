import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { developmentCsp } from './electron/renderer-security';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // .env.local is an uncommitted link to the shared browser-safe project config.
  const local = loadEnv(mode, process.cwd(), 'POSTHOG_');
  return {
  main: {
    define: {
      'import.meta.env.MAIN_VITE_POSTHOG_KEY': JSON.stringify(local.POSTHOG_PROJECT_KEY ?? ''),
      'import.meta.env.MAIN_VITE_POSTHOG_HOST': JSON.stringify(local.POSTHOG_HOST ?? ''),
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: 'hidden',
      rollupOptions: {
        // Keep the N-API package's loader and platform binary paths intact.
        external: ['electron', '@napi-rs/keyring'],
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
      sourcemap: 'hidden',
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
  };
});
