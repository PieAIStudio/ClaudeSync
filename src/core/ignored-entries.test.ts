import { execFileSync } from 'node:child_process';
import { basename, join, relative } from 'node:path';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CHAT_A, CHAT_B, ID_A, ID_B, indexPath, loadFixtureWorkspace, SCOPE_A, SCOPE_B, temporaryFixture } from '../../tests/fixture';
import { buildOperationPlan } from './operations';
import { buildRestorePlan, commitFilePlan, listBackups } from './transaction';

let root: string;
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const load = () => loadFixtureWorkspace(join(root, 'config.json'));

// Does not follow links or read special files, even in the evidence helper.
function structure(path: string): unknown {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return { link: readlinkSync(path) };
  if (info.isDirectory()) return Object.fromEntries(readdirSync(path).sort().map((name) => [name, structure(join(path, name))]));
  return info.isFile() ? { bytes: readFileSync(path).toString('hex'), mode: info.mode } : { mode: info.mode };
}
function seedUnknown(): string[] {
  const scope = join(root, 'session-root', SCOPE_A);
  const directory = join(scope, 'unknown');
  mkdirSync(join(directory, 'nested'), { recursive: true });
  writeFileSync(join(directory, 'nested', 'keep'), Buffer.from([0, 255, 13, 10]));
  symlinkSync(directory, join(directory, 'cycle'), 'dir');
  const file = join(scope, 'unknown.json'); writeFileSync(file, 'NOT JSON: do not parse');
  const link = join(scope, 'unknown-link'); symlinkSync(join(root, 'project'), link, 'dir');
  const malformed = join(scope, 'local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json'); writeFileSync(malformed, '{bad json');
  const nativeLink = join(scope, 'local_dddddddd-dddd-4ddd-8ddd-dddddddddddd.json'); symlinkSync(indexPath(root, SCOPE_A, CHAT_A), nativeLink);
  const sibling = join(root, 'session-root', ID_A, 'unknown-organization'); mkdirSync(sibling);
  const login = join(root, 'session-root', 'unknown-login'); mkdirSync(login);
  const paths = [directory, file, link, malformed, nativeLink, sibling, login];
  if (process.platform !== 'win32') {
    const pipe = join(scope, 'mystery.pipe'); execFileSync('mkfifo', [pipe]); paths.push(pipe);
  }
  return paths;
}

it.each(['sync', 'archive', 'delete'] as const)('skips unknown entries and preserves their bytes, links and structure through %s and restore', (kind) => {
  const paths = seedUnknown();
  const before = paths.map(structure);
  const workspace = load();
  expect(workspace.entries).toHaveLength(3);
  expect(workspace.snapshot.skippedPaths).toHaveLength(paths.length);
  for (const path of paths) expect(workspace.snapshot.files.has(relative(join(root, 'session-root'), path).replaceAll('\\', '/'))).toBe(false);
  const plan = buildOperationPlan(workspace, { kind, sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] });
  expect(plan.changes.length).toBeGreaterThan(0);
  const result = commitFilePlan(workspace, plan, () => undefined);
  expect(result.verified).toBe(true);
  if (kind !== 'delete') commitFilePlan(load(), buildRestorePlan(load(), basename(result.backup!)), () => undefined);
  else expect(readFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`)).length).toBeGreaterThan(0);
  expect(paths.map(structure)).toEqual(before);
});

it('does not let unrelated unknown entries or their changes invalidate a known-chat operation', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  const paths = seedUnknown();
  expect(commitFilePlan(workspace, plan, () => undefined).verified).toBe(true);
  const fresh = load();
  const next = buildOperationPlan(fresh, { kind: 'unarchive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  writeFileSync(paths[1]!, 'Changed opaque file');
  expect(commitFilePlan(fresh, next, () => undefined).verified).toBe(true);
});

it.each(['link', 'directory', 'file parent', 'linked parent'])('still blocks an occupied or unsafe actual write target: %s', (scenario) => {
  const target = indexPath(root, SCOPE_B, CHAT_B);
  if (scenario === 'link') symlinkSync(join(root, 'config.json'), target);
  if (scenario === 'directory') mkdirSync(target);
  if (scenario.includes('parent')) {
    const directory = join(root, 'session-root', SCOPE_B);
    const alternate = join(root, 'saved-target'); renameSync(directory, alternate);
    if (scenario === 'file parent') writeFileSync(directory, 'not a folder');
    else symlinkSync(alternate, directory, 'dir');
  }
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'sync', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] });
  const source = readFileSync(indexPath(root, SCOPE_A, CHAT_B));
  const before = structure(join(root, 'session-root'));
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow(/claudesync-message:(?:errorUnrecognizedTarget|errorDirectoryInvalid):/u);
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_B))).toEqual(source);
  expect(structure(join(root, 'session-root'))).toEqual(before);
  expect(listBackups(root)).toHaveLength(0);
});
