import { beforeEach, afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { buildOperationPlan } from './operations';
import { buildCatalog } from './catalog';
import { commitFilePlanWithTrash } from './transaction';
import { CHAT_A, CHAT_B, ID_A, SCOPE_A, SCOPE_B, addScope, editIndex, indexPath, loadFixtureWorkspace, temporaryFixture } from '../../tests/fixture';
let root: string;
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const load = () => loadFixtureWorkspace(join(root, 'config.json'));
const request = { kind: 'delete' as const, group: 'visible' as const, sessionIds: [CHAT_B], accountIds: [ID_A] };
const finderBytes = () => Buffer.concat([Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]), Buffer.alloc(28)]);
it('retains valid Finder metadata without treating it as an unknown session store', async () => {
  const paths = ['', ID_A, SCOPE_A, `${SCOPE_A}/backlog`, `${SCOPE_A}/waiting-input`].map(p => join(root, 'session-root', p, '.DS_Store'));
  for (const path of paths) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, finderBytes()); }
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  expect(plan.deletionSnapshot?.skippedPaths).toEqual([]);
  expect(plan.transcriptRemovals).toHaveLength(1);
  await commitFilePlanWithTrash(workspace, plan, () => undefined, async path => renameSync(path, `${path}.fixture-trash`));
  for (const path of paths) expect(readFileSync(path)).toEqual(finderBytes());
});
it.each(['malformed', 'symlink', 'directory', 'oversized'])('keeps %s Finder-named entries conservative', (kind) => {
  const path = join(root, 'session-root', '.DS_Store');
  if (kind === 'symlink') symlinkSync(indexPath(root, SCOPE_A, CHAT_B), path);
  else if (kind === 'directory') mkdirSync(path);
  else writeFileSync(path, kind === 'malformed' ? Buffer.from('{}') : Buffer.concat([finderBytes(), Buffer.alloc(1024 * 1024)]));
  const plan = buildOperationPlan(load(), request);
  expect(plan.deletionSnapshot?.skippedPaths).toContain('.DS_Store');
  expect(plan.transcriptRemovals).toEqual([]);
});
it.each(['corrupt-finder', 'unknown-store'])('refuses Trash if %s appears after the preview', async kind => {
  const path = join(root, 'session-root', '.DS_Store');
  writeFileSync(path, finderBytes());
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  expect(plan.transcriptRemovals).toHaveLength(1);
  writeFileSync(kind === 'corrupt-finder' ? path : join(root, 'session-root', 'unknown-store'), '{}');
  const moved: string[] = [];
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, async p => { moved.push(p); })).rejects.toThrow('claudesync-message:errorOtherAccountChanged');
  expect(moved).toEqual([]);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});
it.each(['deleted', 'scheduled'] as const)('trashes only selected %s transcripts and retains deletion protection', async (group) => {
  const marker = join(root, 'session-root', SCOPE_A, `deleted_${CHAT_B}`);
  if (group === 'deleted') writeFileSync(marker, 'original deletion note');
  else editIndex(root, SCOPE_A, CHAT_B, { scheduledTaskId: 'removed-fixture-task', cloudSessionId: 'fixture-linked-cloud-record' });
  const workspace = load();
  expect(buildCatalog(workspace).sessions.find((session) => session.id === CHAT_B)?.deletable).toBe(true);
  const body = join(root, 'projects/project', `${CHAT_B}.jsonl`);
  const bytes = readFileSync(body);
  const untouched = join(root, 'project', 'keep.txt');
  writeFileSync(untouched, 'project file');
  const trash = join(root, '.Trash'); mkdirSync(trash);
  const moved: string[] = [];
  const result = await commitFilePlanWithTrash(workspace, buildOperationPlan(workspace, { ...request, group }), () => undefined, async (path) => {
    moved.push(path); renameSync(path, join(trash, `${CHAT_B}.jsonl`));
  });
  expect(moved).toEqual([body]);
  expect(readFileSync(join(trash, `${CHAT_B}.jsonl`))).toEqual(bytes);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(false);
  expect(existsSync(marker)).toBe(true);
  if (group === 'deleted') expect(readFileSync(marker, 'utf8')).toBe('original deletion note');
  expect(readFileSync(untouched, 'utf8')).toBe('project file');
  expect(load().tombstones.has(CHAT_B)).toBe(true);
  expect(result.trashCount).toBe(1);
  expect(result.backup).toBeUndefined();
});
it.each(['deleted', 'scheduled'] as const)('retains the shared entry-ID guard for %s cleanup', (group) => {
  if (group === 'deleted') writeFileSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_B}`), 'original');
  else editIndex(root, SCOPE_A, CHAT_B, { scheduledTaskId: 'removed-fixture-task' });
  addScope(root, ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc', SCOPE_A);
  const peer = indexPath(root, ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc', CHAT_B);
  // Keep the peer outside the selected group even when deletion has precedence.
  const record = JSON.parse(readFileSync(peer, 'utf8'));
  record.cliSessionId = CHAT_A;
  writeFileSync(peer, JSON.stringify(record));
  expect(() => buildOperationPlan(load(), { ...request, group })).toThrow('claudesync-message:errorSharedHistoryDelete');
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});
it.each([false, true])('does not offer local cleanup with no scheduled transcript (cloud metadata: %s)', (cloud) => {
  editIndex(root, SCOPE_A, CHAT_B, { scheduledTaskId: 'removed-fixture-task', ...(cloud ? { cloudSessionId: 'fixture-cloud-only' } : {}) });
  const body = join(root, 'projects/project', `${CHAT_B}.jsonl`);
  renameSync(body, `${body}.not-a-local-transcript`);
  const workspace = load();
  expect(buildCatalog(workspace).sessions.find((session) => session.id === CHAT_B)).toMatchObject({ manageable: false, deletable: false });
  expect(() => buildOperationPlan(workspace, { ...request, group: 'scheduled' })).toThrow('claudesync-message:errorUnsupportedSession');
});
it('can directly remove an old duplicate without tombstoning its verified current counterpart', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, oldScope, SCOPE_A);
  const current = readFileSync(indexPath(root, SCOPE_A, CHAT_B));
  const body = readFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`));
  const workspace = load();
  await commitFilePlanWithTrash(workspace, buildOperationPlan(workspace, { ...request, group: 'oldOrganization' }), () => undefined, async () => undefined);
  expect(existsSync(indexPath(root, oldScope, CHAT_B))).toBe(false);
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_B))).toEqual(current);
  expect(readFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toEqual(body);
  expect(existsSync(join(root, 'session-root', oldScope, `deleted_${CHAT_B}`))).toBe(false);
});
it('does not invalidate a deletion while an unrelated body and index are being updated', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  let first = true;
  await commitFilePlanWithTrash(workspace, plan, () => {
    if (!first) return;
    first = false;
    editIndex(root, SCOPE_A, CHAT_A, { title: 'Independent session' });
    writeFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"continued independently"}}\n');
  }, async () => undefined);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(false);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8')).title).toBe('Independent session');
});
it('still stops if a formerly unrelated session starts claiming the body scheduled for removal', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  editIndex(root, SCOPE_B, CHAT_A, { priorCliSessionIds: [CHAT_B] });
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, async () => undefined)).rejects.toThrow();
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});
it('still stops and names the selected session if its own body is updated', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  writeFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`), '{"type":"user","message":{"content":"selected changed"}}\n');
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, async () => undefined)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
});
