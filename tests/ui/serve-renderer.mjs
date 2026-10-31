import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { developmentCsp } from '../../electron/renderer-security.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) ?? process.env.UI_TEST_PORT ?? 4173);

const server = await createServer({
  root,
  plugins: [react(), developmentCsp()],
  server: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'error',
});
await server.listen();
await new Promise(() => {});
