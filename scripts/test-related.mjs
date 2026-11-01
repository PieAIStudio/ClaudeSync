// Feed committed source paths to Vitest's existing import-graph selector.
// Deliberately exclude package/config triggers: they must not turn into a full suite.
import { execFileSync, spawnSync } from 'node:child_process';

const base = process.env.PUSH_GATE_BASE;
const head = process.env.PUSH_GATE_HEAD;
if (!base || !head) {
  console.error('Related unit selection requires PUSH_GATE_BASE and PUSH_GATE_HEAD from the push gate.');
  process.exit(1);
}
const paths = execFileSync('git', [
  'diff', '--name-only', '--no-renames', '-z', base, head, '--', 'src', 'electron',
], { encoding: 'utf8' }).split('\0').filter((path) => /\.(?:ts|tsx)$/.test(path));
if (!paths.length) {
  console.error('GAP (not a pass): no committed TypeScript source paths for related unit selection.');
  process.exit(1);
}
console.log(`Related unit source paths: ${paths.join(', ')}`);
const result = spawnSync('pnpm', ['exec', 'vitest', 'related', '--run', ...paths], {
  stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
