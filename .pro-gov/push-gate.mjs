#!/usr/bin/env node
/** Related checks only. Repo-owned mappings are trusted executable configuration. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function git(root, args, env) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}

export function outgoingPaths(root, base, env = process.env) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], env);
  const baseCommit = git(root, ['rev-parse', '--verify', `${base}^{commit}`], env);
  const mergeBase = git(root, ['merge-base', baseCommit, head], env);
  // No rename collapsing: both the old and new dependency boundaries need checks.
  const paths = git(root, ['diff', '--name-only', '--no-renames', '-z', mergeBase, head, '--'], env)
    .split('\0')
    .filter(Boolean)
    .sort();
  return { head, base: baseCommit, mergeBase, paths };
}

export function selectChecks(paths, mapping) {
  if (mapping.version !== 1 || !Array.isArray(mapping.rules) || !Array.isArray(mapping.blindSpots))
    throw new Error('Expected push-gate mapping version 1 with rules and blindSpots');
  for (const rule of mapping.rules) {
    if (
      !Array.isArray(rule.paths) ||
      !rule.paths.length ||
      rule.paths.some((path) => typeof path !== 'string' || !path) ||
      !Array.isArray(rule.commands) ||
      rule.commands.some((cmd) => typeof cmd !== 'string' || !cmd) ||
      (!rule.commands.length && !rule.reason)
    )
      throw new Error('Each rule needs paths and commands, or an explicit no-check reason');
  }
  if (mapping.blindSpots.some((item) => typeof item !== 'string'))
    throw new Error('blindSpots must contain descriptions');
  const commands = new Map();
  const gaps = [];
  const noChecks = [];
  for (const path of paths) {
    const rules = mapping.rules.filter((rule) =>
      rule.paths.some((glob) => matchesGlob(path, glob)),
    );
    if (!rules.length) gaps.push(path);
    for (const rule of rules) {
      if (!rule.commands.length) noChecks.push({ path, reason: rule.reason });
      for (const command of rule.commands) {
        if (!commands.has(command)) commands.set(command, []);
        if (!commands.get(command).includes(path)) commands.get(command).push(path);
      }
    }
  }
  return {
    checks: [...commands].map(([command, paths]) => ({ command, paths })),
    gaps,
    noChecks,
    blindSpots: mapping.blindSpots,
  };
}

export function runPushGate(args = process.argv.slice(2)) {
  try {
    let base = 'origin/main';
    let map = '.pro-gov/push-gate.json';
    let planOnly = false;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--plan') planOnly = true;
      else if (arg === '--base' || arg === '--map') {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
        if (arg === '--base') base = value;
        else map = value;
      } else if (arg === '--help') {
        console.log(
          'pro-gov push-gate [--base origin/main] [--map .pro-gov/push-gate.json] [--plan]',
        );
        return 0;
      } else throw new Error(`Unknown push-gate option: ${arg}`);
    }
    const root = git(process.cwd(), ['rev-parse', '--show-toplevel'], process.env);
    // Hooks export GIT_DIR etc.; tests creating fixture repos must not inherit them.
    const env = { ...process.env };
    for (const key of git(root, ['rev-parse', '--local-env-vars'], process.env).split('\n'))
      delete env[key];
    const range = outgoingPaths(root, base, env);
    const mapping = JSON.parse(readFileSync(resolve(root, map), 'utf8'));
    const plan = { ...range, ...selectChecks(range.paths, mapping) };
    if (planOnly) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(
        `Push gate: ${range.mergeBase}..${range.head}; ${range.paths.length} changed paths`,
      );
      for (const spot of plan.blindSpots) console.log(`BLIND SPOT: ${spot}`);
      for (const item of plan.noChecks) console.log(`NO CHECK: ${item.path} — ${item.reason}`);
      for (const path of plan.gaps) console.error(`GAP (not a pass): ${path}`);
      for (const check of plan.checks) {
        console.log(`CHECK: ${check.command}\n  selected by: ${check.paths.join(', ')}`);
        const start = performance.now();
        const result = spawnSync(check.command, {
          cwd: root,
          env: { ...env, PUSH_GATE_BASE: range.mergeBase, PUSH_GATE_HEAD: range.head },
          shell: true,
          stdio: 'inherit',
        });
        console.log(`CHECK TIME: ${((performance.now() - start) / 1000).toFixed(3)}s`);
        if (result.error) throw result.error;
        if (result.status !== 0) {
          console.error(`Push blocked: check failed (${result.status ?? result.signal})`);
          return 1;
        }
      }
    }
    if (plan.gaps.length) {
      console.error(`Push blocked: ${plan.gaps.length} unmapped path(s); no full-suite fallback`);
      return 1;
    }
    if (!planOnly)
      console.log(`Related checks passed (${plan.checks.length}); listed blind spots remain.`);
    return 0;
  } catch (error) {
    console.error(`Push gate stopped: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  basename(fileURLToPath(import.meta.url)) === 'push-gate.mjs' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = runPushGate();
