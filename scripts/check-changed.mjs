// Compatibility entry; scripts/check-map.json is the single repo-owned map.
import { runPushGate } from '../.pro-gov/push-gate.mjs';

const args = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--base=') ? ['--base', arg.slice('--base='.length)] : [arg],
);
if (!args.includes('--base') && process.env.CHECK_CHANGED_BASE)
  args.push('--base', process.env.CHECK_CHANGED_BASE);
process.exitCode = runPushGate(args);
