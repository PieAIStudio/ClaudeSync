import { basename, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sidebarFixture, OLD_SCOPE, syntheticId } from '../../tests/sidebar-fixture';
import { addScope, CHAT_A, ID_A, ID_B, SCOPE_A, editIndex, indexPath, loadFixtureWorkspace } from '../../tests/fixture';
import { buildCatalog } from './catalog';
import { executeOldCleanup, planOldCleanup } from './old-organization';
import { loadWorkspace } from './workspace';

let root: string;
beforeEach(() => { root = sidebarFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const load = () => loadFixtureWorkspace(join(root, 'config.json'));

function fakeTrash() {
  const directory = join(root, 'fake-trash');
  mkdirSync(directory);
  let calls = 0;
  return { directory, trash: async (path: string) => {
    // The actual app uses Electron shell.trashItem. The test moves fixture bytes.
    renameSync(path, join(directory, String(++calls) + '-' + basename(path)));
  } };
}
it('lists every old file and its actual current counterpart before action', () => {
  const workspace = load();
  const before = [...workspace.snapshot.files];
  const plan = planOldCleanup(workspace, [ID_A]);
  expect(plan.items).toHaveLength(10);
  expect(plan.items.filter((item) => item.currentHasCopy)).toHaveLength(4);
  expect(plan.items.filter((item) => !item.currentHasCopy)).toHaveLength(6);
  expect(plan.items.filter((item) => item.action === 'restoreArchived')).toHaveLength(6);
  expect(plan.imports).toHaveLength(6);
  expect(plan.archiveHints).toHaveLength(1);
  expect(plan.items.every((item) => item.oldScope === OLD_SCOPE)).toBe(true);
  expect([...load().snapshot.files]).toEqual(before);
});
it('returns six unique old-only sessions archived, trashes ten old copies and reads back 4/0', async () => {
  const workspace = load();
  const currentBytes = readFileSync(indexPath(root, SCOPE_A, CHAT_A));
  const transcriptBytes = readFileSync(join(root, 'projects/project', syntheticId(100) + '.jsonl'));
  const plan = planOldCleanup(workspace, [ID_A]);
  const { directory, trash } = fakeTrash();
  const result = await executeOldCleanup(workspace, plan, trash, () => undefined);
  expect(result).toEqual({ trashed: 10, importedArchived: 6, mainUnchanged: true, oldCopiesRemaining: 0 });
  expect(readdirSync(directory)).toHaveLength(10);
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_A))).toEqual(currentBytes);
  expect(readFileSync(join(root, 'projects/project', syntheticId(100) + '.jsonl'))).toEqual(transcriptBytes);
  const after = load();
  const account = buildCatalog(after).accounts.find((a) => a.id === ID_A)!;
  expect(account).toMatchObject({ visible: 4, archived: 8, scheduled: 7, oldCopies: 0, deletedMarkers: 1 });
  for (let n = 100; n < 106; n++) {
    expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, syntheticId(n)), 'utf8')).isArchived).toBe(true);
    const nativeHint = JSON.parse(readFileSync(join(root, 'session-root', SCOPE_A, 'archived-sessions.idx'), 'utf8'));
    expect(nativeHint.archived).toContain('local_' + syntheticId(n));
    expect(existsSync(indexPath(root, OLD_SCOPE, syntheticId(n)))).toBe(false);
  }
});
it('refuses missing organization or deletion marker before any old file moves', () => {
  const workspace = loadWorkspace(join(root, 'config.json'));
  expect(() => planOldCleanup(workspace, [ID_A])).toThrow('未核实');
  expect(() => planOldCleanup(load(), [ID_B])).not.toThrow();
  writeFileSync(join(root, 'session-root', OLD_SCOPE, 'deleted_' + syntheticId(100)), '0');
  expect(() => planOldCleanup(load(), [ID_A])).toThrow('已删除');
  expect(existsSync(indexPath(root, OLD_SCOPE, syntheticId(100)))).toBe(true);
});
it('fails closed when a source changes between preview and execution', async () => {
  const workspace = load();
  const plan = planOldCleanup(workspace, [ID_A]);
  editIndex(root, OLD_SCOPE, syntheticId(100), { title: 'Synthetic changed after preview' });
  const { directory, trash } = fakeTrash();
  await expect(executeOldCleanup(workspace, plan, trash, () => undefined)).rejects.toThrow('已变化');
  expect(readdirSync(directory)).toHaveLength(0);
  expect(existsSync(indexPath(root, OLD_SCOPE, syntheticId(100)))).toBe(true);
});
it('does not perform a second Trash operation after a simulated failure', async () => {
  const workspace = load();
  const plan = planOldCleanup(workspace, [ID_A]);
  const { directory, trash } = fakeTrash();
  let called = 0;
  await expect(executeOldCleanup(workspace, plan, async (path) => {
    if (++called === 2) throw new Error('Synthetic trash denied');
    await trash(path);
  }, () => undefined)).rejects.toThrow('已移入废纸篓 1 条');
  expect(readdirSync(directory)).toHaveLength(1);
  expect(called).toBe(2);
  expect(buildCatalog(load()).accounts.find((a) => a.id === ID_A)?.visible).toBe(4);
});
it('imports an archived old-only record without making it ordinary', async () => {
  editIndex(root, OLD_SCOPE, syntheticId(100), { isArchived: true });
  const workspace = load();
  const plan = planOldCleanup(workspace, [ID_A]);
  const { trash } = fakeTrash();
  await executeOldCleanup(workspace, plan, trash, () => undefined);
  expect(buildCatalog(load()).accounts.find((a) => a.id === ID_A)?.visible).toBe(4);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, syntheticId(100)), 'utf8')).isArchived).toBe(true);
});
it('imports an old-only session exactly once across two old organizations', async () => {
  const otherOld = ID_A + '/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  addScope(root, otherOld, OLD_SCOPE);
  const workspace = load();
  const plan = planOldCleanup(workspace, [ID_A]);
  expect(plan.items).toHaveLength(20);
  expect(plan.imports).toHaveLength(6);
  expect(plan.items.filter((item) => item.action === 'restoreArchived')).toHaveLength(6);
  const { trash } = fakeTrash();
  expect(await executeOldCleanup(workspace, plan, trash, () => undefined)).toEqual({
    trashed: 20, importedArchived: 6, mainUnchanged: true, oldCopiesRemaining: 0,
  });
  expect(buildCatalog(load()).accounts.find((account) => account.id === ID_A)).toMatchObject({ visible: 4, archived: 8, oldCopies: 0 });
});

it('does not move a source with unsupported scheduled metadata', () => {
  editIndex(root, OLD_SCOPE, syntheticId(100), { scheduledTaskId: 'fixture-run' });
  expect(() => planOldCleanup(load(), [ID_A])).toThrow('定时');
});
it('never deletes unconfigured sibling copies silently', () => {
  const configPath = join(root, 'config.json');
  const json = JSON.parse(readFileSync(configPath, 'utf8'));
  json.accounts = json.accounts.filter((account: {scope:string}) => account.scope !== OLD_SCOPE);
  writeFileSync(configPath, JSON.stringify(json));
  expect(() => planOldCleanup(load(), [ID_A])).toThrow('未列入');
});
