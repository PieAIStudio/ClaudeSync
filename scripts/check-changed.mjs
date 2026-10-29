import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const map = JSON.parse(readFileSync(new URL('./check-map.json', import.meta.url), 'utf8'));
const cliBase = process.argv.slice(2).find((argument) => argument.startsWith('--base='))?.slice('--base='.length);
const base = cliBase || process.env.CHECK_CHANGED_BASE || 'origin/main';

function patternToRegExp(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (character === '*') {
      expression += '[^/]*';
    } else {
      expression += character.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`);
}

const compiled = Object.fromEntries(Object.entries(map.checks).map(([check, patterns]) => [check, patterns.map(patternToRegExp)]));
let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').map((path) => path.trim()).filter(Boolean);
} catch (error) {
  console.error(`check:changed could not read diff against ${base}`);
  process.exit(error.status || 1);
}

const selected = Object.keys(map.checks).filter((check) => changed.some((path) => compiled[check].some((pattern) => pattern.test(path))));
console.log(`check:changed base=${base}`);
console.log(`changed files (${changed.length}): ${changed.length ? changed.join(', ') : '(none)'}`);
console.log(`selected checks (${selected.length}): ${selected.length ? selected.join(', ') : '(none)'}`);
if (!selected.length) process.exit(0);

const totalStart = performance.now();
for (const check of selected) {
  const start = performance.now();
  console.log(`\n>>> pnpm run ${check}`);
  const result = spawnSync('pnpm', ['run', check], { stdio: 'inherit', env: process.env });
  const seconds = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`<<< ${check}: status=${result.status ?? 1}, elapsed=${seconds}s`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`check:changed complete elapsed=${((performance.now() - totalStart) / 1000).toFixed(2)}s`);
