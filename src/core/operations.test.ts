import { basename, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { buildOperationPlan } from './operations';
import { buildRestorePlan, commitFilePlan, commitFilePlanWithTrash, listBackups, workspaceRevision } from './transaction';
import { buildWorkspacePlan } from './workspace';
import { parseMessage } from '../error-copy';
import { loadFixtureWorkspace as loadWorkspace } from '../../tests/fixture';
import { addScope, CHAT_A, CHAT_B, editIndex, ID_A, ID_B, indexPath, SCOPE_A, SCOPE_B, temporaryFixture } from '../../tests/fixture';
import type { OperationRequest } from '../shared/contracts';

const CHAT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let root: string;
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const load = () => loadWorkspace(join(root, 'config.json'));
function operation(kind: Exclude<OperationRequest['kind'], 'delete'>, sessionIds = [CHAT_A], accountIds = [ID_A, ID_B], title?: string) {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind, sessionIds, accountIds, title });
  const result = commitFilePlan(workspace, plan, () => undefined);
  return { plan, result };
}

function addSyntheticSession(scope: string, sessionId: string): void {
  const source = JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_B), 'utf8')) as Record<string, unknown>;
  writeFileSync(indexPath(root, scope, sessionId), JSON.stringify({ ...source, sessionId: `local_${sessionId}`, cliSessionId: sessionId, title: `Synthetic ${sessionId}` }));
  writeFileSync(join(root, 'projects/project', `${sessionId}.jsonl`), '{"type":"user","message":{"content":"fixture"}}\n');
}

async function deleteOperation(sessionIds = [CHAT_A], accountIds = [ID_A, ID_B], trashPaths: string[] = []) {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds, accountIds });
  const trash = async (path: string) => {
    trashPaths.push(path);
    const directory = join(root, 'fake-trash');
    mkdirSync(directory, { recursive: true });
    renameSync(path, join(directory, `${readdirSync(directory).length}-${basename(path)}`));
  };
  const result = await commitFilePlanWithTrash(workspace, plan, () => undefined, trash);
  return { plan, result };
}

it('counts one session once per login account across duplicate folders', () => {
  addScope(root, `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`, SCOPE_A);
  const catalog = buildCatalog(load());
  expect(catalog.accounts).toHaveLength(2);
  expect(catalog.accounts.find((account) => account.id === ID_A)).toMatchObject({ total: 2, active: 2, copies: 4 });
  expect(catalog.sessions).toHaveLength(2);
});

it('syncs only selected sessions and resets copied permission state', () => {
  const { plan } = operation('sync', [CHAT_A]);
  expect(plan.changes.every((change) => change.sessionId === CHAT_A)).toBe(true);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_B))).toBe(false);
  operation('sync', [CHAT_B]);
  const copied = JSON.parse(readFileSync(indexPath(root, SCOPE_B, CHAT_B), 'utf8'));
  expect(copied.permissionMode).toBe('default');
  expect(buildWorkspacePlan(load()).additions).toHaveLength(0);
});

it('preserves native task backlog bytes through sync, archive, removal and restore', async () => {
  const backlogPaths = [SCOPE_A, SCOPE_B].map((scope) => {
    const directory = join(root, 'session-root', scope, 'backlog');
    mkdirSync(directory);
    const path = join(directory, 'tasks.json');
    writeFileSync(path, `{"version":1,"items":[],"private":"${scope}"}\n`);
    return [path, readFileSync(path)] as const;
  });
  for (const kind of ['sync', 'archive', 'delete'] as const) {
    const { plan, result } = kind === 'delete' ? await deleteOperation([CHAT_B]) : operation(kind, [CHAT_B]);
    expect(plan.changes.every((change) => !change.path.includes('/backlog/'))).toBe(true);
    if (kind === 'delete') expect(result.backup).toBeUndefined();
    else commitFilePlan(load(), buildRestorePlan(load(), basename(result.backup!)), () => undefined);
    for (const [path, raw] of backlogPaths) expect(readFileSync(path)).toEqual(raw);
  }
});

it.each(['empty', 'regular files'])('preserves native waiting-input with %s through sync, archive, removal and restore', async (contents) => {
  const directories = [SCOPE_A, SCOPE_B].map((scope) => {
    const directory = join(root, 'session-root', scope, 'waiting-input');
    mkdirSync(directory);
    const raw = Buffer.from(`Opaque Desktop state: ${scope}\r\n\0`);
    if (contents === 'regular files') writeFileSync(join(directory, `local_${CHAT_B}.json`), raw);
    return { directory, raw };
  });
  for (const kind of ['sync', 'archive', 'delete'] as const) {
    const { plan, result } = kind === 'delete' ? await deleteOperation([CHAT_B]) : operation(kind, [CHAT_B]);
    expect(result.verified).toBe(true);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(plan.changes.every((change) => !change.path.includes('/waiting-input/'))).toBe(true);
    if (kind === 'delete') expect(result.backup).toBeUndefined();
    else commitFilePlan(load(), buildRestorePlan(load(), basename(result.backup!)), () => undefined);
    for (const { directory, raw } of directories) {
      expect(readdirSync(directory)).toEqual(contents === 'empty' ? [] : [`local_${CHAT_B}.json`]);
      if (contents === 'regular files') expect(readFileSync(join(directory, `local_${CHAT_B}.json`))).toEqual(raw);
    }
  }
});

it.each(['edit', 'add', 'remove'] as const)('blocks a stale preview after waiting-input file %s before creating a backup or changing chats', (change) => {
  const directory = join(root, 'session-root', SCOPE_A, 'waiting-input');
  mkdirSync(directory);
  const path = join(directory, 'pending');
  if (change !== 'add') writeFileSync(path, 'Original Desktop state');
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  const chatBefore = readFileSync(indexPath(root, SCOPE_A, CHAT_A));
  if (change === 'remove') rmSync(path);
  else writeFileSync(path, 'Changed Desktop state');
  expect(workspaceRevision(load())).not.toBe(workspaceRevision(workspace));
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorWorkspaceChanged');
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_A))).toEqual(chatBefore);
  expect(listBackups(root)).toHaveLength(0);
});

it.each(['edit', 'add', 'remove'] as const)('blocks a stale preview after backlog task %s before creating a backup or changing chats', (change) => {
  const directory = join(root, 'session-root', SCOPE_A, 'backlog');
  mkdirSync(directory);
  const path = join(directory, 'tasks.json');
  if (change !== 'add') writeFileSync(path, '{"version":1,"items":[]}');
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  const chatBefore = readFileSync(indexPath(root, SCOPE_A, CHAT_A));
  if (change === 'remove') rmSync(path);
  else writeFileSync(path, '{"version":1,"items":[{"id":"todo_012345abcdef"}]}');
  expect(workspaceRevision(load())).not.toBe(workspaceRevision(workspace));
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorWorkspaceChanged');
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_A))).toEqual(chatBefore);
  expect(listBackups(root)).toHaveLength(0);
});

it('scopes archive previews to changed accounts and unique sessions', () => {
  const preview = buildOperationPlan(load(), { kind: 'archive', group: 'visible', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] }).preview;
  expect(preview.accountIds).toEqual([ID_A]);
  expect(preview.changes).toHaveLength(1);
  expect(preview.changes[0]).toMatchObject({ accountId: ID_A, sessionId: CHAT_B, action: 'archive' });
});

it('lists two changed accounts and two sessions once', () => {
  addSyntheticSession(SCOPE_B, CHAT_C);
  const preview = buildOperationPlan(load(), { kind: 'archive', group: 'visible', sessionIds: [CHAT_B, CHAT_C], accountIds: [ID_A, ID_B] }).preview;
  expect(preview.accountIds).toEqual([ID_A, ID_B]);
  expect(preview.changes).toHaveLength(2);
  expect(preview.changes.map((change) => `${change.accountId}:${change.sessionId}`)).toEqual([`${ID_A}:${CHAT_B}`, `${ID_B}:${CHAT_C}`]);
});

it('collapses a session reached through two local copies into one plan row', () => {
  const extra = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(root, extra, SCOPE_A);
  const preview = buildOperationPlan(load(), { kind: 'archive', sessionIds: [CHAT_B], accountIds: [ID_A] }).preview;
  expect(preview.accountIds).toEqual([ID_A]);
  expect(preview.changes).toHaveLength(1);
  expect(preview.changes[0]).toMatchObject({ accountId: ID_A, sessionId: CHAT_B, copies: 2 });
});

it('archives all copies in included accounts, updates both native archive formats, and unarchives', () => {
  const extra = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(root, extra, SCOPE_A);
  operation('archive');
  for (const scope of [SCOPE_A, extra, SCOPE_B]) {
    expect(JSON.parse(readFileSync(indexPath(root, scope, CHAT_A), 'utf8')).isArchived).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'session-root', scope, 'archived-sessions.idx'), 'utf8')).archived).toContain(`local_${CHAT_A}`);
  }
  expect(buildCatalog(load()).accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 1, archived: 1 });
  operation('unarchive');
  expect(load().entries.filter((entry) => entry.data.cliSessionId === CHAT_A).every((entry) => entry.eligible && !entry.archived)).toBe(true);
});

it('keeps the selected active set only in verified organizations and leaves old and excluded copies alone', () => {
  const extra = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  const scopeC = '33333333-3333-4333-8333-333333333333/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  addScope(root, extra, SCOPE_A); addScope(root, scopeC, SCOPE_A);
  const beforeC = readdirSync(join(root, 'session-root', scopeC)).map((name) => [name, readFileSync(join(root, 'session-root', scopeC, name))] as const);
  operation('archive', [CHAT_B], [ID_A]);
  const { result } = operation('keep', [CHAT_B]);
  expect(result.verified).toBe(true);
  const after = load();
  for (const scope of [SCOPE_A, SCOPE_B]) expect(after.entries.filter((entry) => entry.account.scope === scope && !entry.archived).map((entry) => entry.data.cliSessionId)).toEqual([CHAT_B]);
  expect(after.entries.filter((entry) => entry.account.scope === extra && !entry.archived).map((entry) => entry.data.cliSessionId)).toEqual([CHAT_A]);
  for (const [name, raw] of beforeC) expect(readFileSync(join(root, 'session-root', scopeC, name))).toEqual(raw);
});

it('keeps the same ten chosen sessions across three accounts rather than limiting by folder record count', () => {
  const scopeC = '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, scopeC);
  const chosen = [CHAT_A, CHAT_B];
  const source = JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_B), 'utf8'));
  for (let n = 1; n <= 10; n++) {
    const id = `${String(n).padStart(8, '0')}-dddd-4ddd-8ddd-dddddddddddd`;
    writeFileSync(indexPath(root, SCOPE_A, id), JSON.stringify({ ...source, sessionId: `local_${id}`, cliSessionId: id, title: `Chat ${n}` }));
    writeFileSync(join(root, 'projects/project', `${id}.jsonl`), '{"type":"user","message":{"content":"fixture"}}\n');
    if (n <= 8) chosen.push(id);
  }
  operation('keep', chosen, [ID_A, ID_B, scopeC.split('/')[0]!]);
  const after = load();
  for (const scope of [SCOPE_A, SCOPE_B, scopeC]) {
    expect(after.entries.filter((entry) => entry.account.scope === scope && !entry.archived).map((entry) => entry.data.cliSessionId).sort()).toEqual([...chosen].sort());
  }
  expect(buildCatalog(after).accounts.every((account) => account.active === 10)).toBe(true);
});

it('refuses keep-only before any write if selected transcripts are missing', () => {
  rmSync(join(root, 'projects/project', `${CHAT_B}.jsonl`));
  const workspace = load();
  expect(() => buildOperationPlan(workspace, { kind: 'keep', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] })).toThrow('claudesync-message:errorKeepSessionUnavailable');
  expect(workspace.snapshot.files).toEqual(load().snapshot.files);
  expect(listBackups(root)).toHaveLength(0);
});

it('does not let a target deletion marker resurrect a selected session', () => {
  writeFileSync(join(root, 'session-root', SCOPE_B, `deleted_${CHAT_B}`), '1234567890123');
  expect(() => buildOperationPlan(load(), { kind: 'keep', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] })).toThrow();
  expect(buildWorkspacePlan(load()).additions).toHaveLength(0);
});

it('moves exclusive transcripts to Trash before changing records or markers', async () => {
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const trashPaths: string[] = [];
  const { result } = await deleteOperation([CHAT_A], [ID_A, ID_B], trashPaths);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_A))).toBe(false);
  expect(existsSync(bodyPath)).toBe(false);
  expect(buildWorkspacePlan(load()).additions).toHaveLength(1); // Only unrelated chat B.
  expect(result.backup).toBeUndefined();
  expect(result.trashCount).toBe(1);
  expect(trashPaths).toEqual([bodyPath]);
  expect(existsSync(join(root, 'backups'))).toBe(false);
  expect(listBackups(root)).toEqual([]);
  expect(existsSync(join(root, 'project'))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});

it('keeps shared transcripts and unchecked accounts while deleting a selected account session', async () => {
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const before = readFileSync(bodyPath);
  const other = readFileSync(indexPath(root, SCOPE_B, CHAT_A));
  await deleteOperation([CHAT_A], [ID_A]);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(readFileSync(indexPath(root, SCOPE_B, CHAT_A))).toEqual(other);
  expect(readFileSync(bodyPath)).toEqual(before);
  expect(listBackups(root)).toEqual([]);
});

it('protects transcripts claimed by a login omitted entirely from configuration', async () => {
  const omitted = '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, omitted, SCOPE_A);
  const path = join(root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.filter((account: { scope: string }) => account.scope !== omitted);
  writeFileSync(path, JSON.stringify(config));
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const raw = readFileSync(bodyPath);
  await deleteOperation([CHAT_A]);
  expect(readFileSync(bodyPath)).toEqual(raw);
  expect(existsSync(indexPath(root, omitted, CHAT_A))).toBe(true);
});

it('does not allow deletion through the permanent-write transaction entry point', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorDeleteTrashRequired');
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_A}.jsonl`))).toBe(true);
});

it('keeps transcript removal behind the Trash adapter, not direct delete APIs', () => {
  for (const file of ['./transaction.ts', './old-organization.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:unlinkSync|rmSync|fs\.rm)\b/u);
  }
});

it.each([3, 4])('reports moved transcripts when guard %i stops deletion before any index change', async (stopAt) => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  const before = new Map(plan.changes.map((change) => [change.path, change.before]));
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const trashPath = join(root, `trashed-${CHAT_A}.jsonl`);
  let calls = 0;
  const error = await commitFilePlanWithTrash(workspace, plan, () => {
    if (++calls === stopAt) throw new Error('Quit Claude before continuing');
  }, async (path) => { renameSync(path, trashPath); }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect(parseMessage((error as Error).message)).toMatchObject({
    key: 'errorDeleteInterrupted', params: { applied: 0, moved: basename(bodyPath), message: 'Quit Claude before continuing' },
  });
  for (const [path, raw] of before) {
    const absolute = join(root, 'session-root', path);
    if (raw) expect(readFileSync(absolute)).toEqual(raw);
    else expect(existsSync(absolute)).toBe(false);
  }
  expect(existsSync(bodyPath)).toBe(false);
  expect(existsSync(trashPath)).toBe(true);
  expect(listBackups(root)).toEqual([]);
});

it('reports an index interruption after Trash without backup or permanent removal', async () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  expect(plan.changes.length).toBeGreaterThan(1);
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const trashDirectory = join(root, 'fake-trash');
  mkdirSync(trashDirectory);
  let guardCalls = 0;
  const trashPaths: string[] = [];
  const trash = async (path: string) => {
    trashPaths.push(path);
    renameSync(path, join(trashDirectory, basename(path)));
  };
  const error = await commitFilePlanWithTrash(workspace, plan, () => {
    guardCalls++;
    if (guardCalls === 5) throw new Error('Interrupted during index writes');
  }, trash).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  const parsed = parseMessage((error as Error).message);
  expect(parsed).toMatchObject({ key: 'errorDeleteInterrupted', params: { applied: 1, moved: basename(bodyPath) } });
  expect(guardCalls).toBe(5);
  expect(trashPaths).toEqual([bodyPath]);
  expect(existsSync(bodyPath)).toBe(false);
  expect(readdirSync(trashDirectory)).toEqual([basename(bodyPath)]);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_A))).toBe(true);
  expect(existsSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_A}`))).toBe(false);
  expect(existsSync(join(root, 'session-root', SCOPE_B, `deleted_${CHAT_A}`))).toBe(false);
  expect(listBackups(root)).toEqual([]);
});

it('reports a Trash failure without changing indexes or deletion markers', async () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  const beforeA = readFileSync(indexPath(root, SCOPE_A, CHAT_A));
  const beforeB = readFileSync(indexPath(root, SCOPE_B, CHAT_A));
  let calls = 0;
  const trash = async (path: string) => { calls++; if (calls === 1) throw new Error('Synthetic Trash denied'); renameSync(path, join(root, 'unused-trash')); };
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, trash)).rejects.toThrow('claudesync-message:errorDeleteTrashInterrupted');
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_A))).toEqual(beforeA);
  expect(readFileSync(indexPath(root, SCOPE_B, CHAT_A))).toEqual(beforeB);
  expect(existsSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_A}`))).toBe(false);
  expect(existsSync(join(root, 'session-root', SCOPE_B, `deleted_${CHAT_A}`))).toBe(false);
  expect(calls).toBe(1);
});

it('reports which transcript moved before a later Trash failure', async () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A, CHAT_B], accountIds: [ID_A, ID_B] });
  expect(plan.transcriptRemovals?.length).toBeGreaterThan(1);
  let calls = 0;
  const moved: string[] = [];
  const trash = async (path: string) => { if (++calls === 2) throw new Error('Synthetic second Trash denial'); moved.push(path); };
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, trash)).rejects.toThrow(`${basename(moved[0] ?? '')}`);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(true);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_A))).toBe(true);
  expect(calls).toBe(2);
});

it('refuses deletion when its entry ID is shared history, leaving archive available', async () => {
  editIndex(root, SCOPE_A, CHAT_B, { priorCliSessionIds: [CHAT_A] });
  await expect(deleteOperation([CHAT_A], [ID_A])).rejects.toThrow('claudesync-message:errorSharedHistoryDelete');
  expect(existsSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_A}`))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(true);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
  operation('archive', [CHAT_A], [ID_A]);
  expect(load().entries.find((entry) => entry.data.cliSessionId === CHAT_A && entry.account.scope === SCOPE_A)?.archived).toBe(true);
});

it('protects history claimed by an unconfigured sibling folder of the same login account', async () => {
  const sibling = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(root, sibling, SCOPE_A);
  const path = join(root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.filter((account: { scope: string }) => account.scope !== sibling);
  writeFileSync(path, JSON.stringify(config));
  await expect(deleteOperation([CHAT_A], [ID_A])).rejects.toThrow('claudesync-message:errorSharedHistoryDelete');
  expect(existsSync(indexPath(root, sibling, CHAT_A))).toBe(true);
  expect(listBackups(root)).toHaveLength(0);
});

it('renames one selected session on every selected account without losing private settings', () => {
  editIndex(root, SCOPE_A, CHAT_A, { privateTest: 'preserve', permissionMode: 'bypassPermissions' });
  operation('rename', [CHAT_A], [ID_A, ID_B], 'My chosen title');
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8'))).toMatchObject({ title: 'My chosen title', titleSource: 'user', privateTest: 'preserve', permissionMode: 'bypassPermissions' });
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_B, CHAT_A), 'utf8')).title).toBe('My chosen title');
});

it('supports starring and safely rejects invalid rename and unknown selections', () => {
  operation('star');
  expect(buildCatalog(load()).sessions.find((session) => session.id === CHAT_A)?.starred).toBe(true);
  operation('unstar');
  expect(buildCatalog(load()).sessions.find((session) => session.id === CHAT_A)?.starred).toBe(false);
  expect(() => buildOperationPlan(load(), { kind: 'rename', sessionIds: [CHAT_A, CHAT_B], accountIds: [ID_A], title: 'x' })).toThrow();
  expect(() => buildOperationPlan(load(), { kind: 'archive', sessionIds: ['wrong'], accountIds: [ID_A] })).toThrow();
});

it('blocks stale previews, running-process guards and changed transcripts before mutation', async () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  expect(() => commitFilePlan(workspace, plan, () => { throw new Error('Claude running'); })).toThrow('Claude running');
  editIndex(root, SCOPE_A, CHAT_A, { title: 'A newer title' });
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorWorkspaceChanged');
  const fresh = load();
  const newPlan = buildOperationPlan(fresh, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A] });
  writeFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"newer"}}\n');
  await expect(commitFilePlanWithTrash(fresh, newPlan, () => undefined, async () => undefined)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
});

it('keeps an interrupted journal recoverable and refuses to overwrite later edits', () => {
  const before = load();
  const plan = buildOperationPlan(before, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  let calls = 0;
  expect(() => commitFilePlan(before, plan, () => { if (++calls === 3) throw new Error('Stopped mid-operation'); })).toThrow('claudesync-message:errorBackupInterrupted');
  const backup = listBackups(root)[0]!;
  expect(backup.state).toBe('interrupted');
  const after = load();
  commitFilePlan(after, buildRestorePlan(after, backup.id), () => undefined);
  expect(load().snapshot.files).toEqual(before.snapshot.files);
  const result = operation('archive', [CHAT_A], [ID_A]).result;
  editIndex(root, SCOPE_A, CHAT_A, { title: 'Newer work' });
  expect(() => buildRestorePlan(load(), basename(result.backup!))).toThrow('claudesync-message:errorRestoreSessionChanged');
  expect(() => buildRestorePlan(load(), '../bad')).toThrow('claudesync-message:errorInvalidBackupId');
});

it('restores affected folders after refresh adds an unrelated organization and rewrites settings', () => {
  const before = load().snapshot.files;
  const { result } = operation('archive', [CHAT_A], [ID_A]);
  addScope(root, `${ID_B}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`);
  const configPath = join(root, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.accounts.reverse();
  config.accounts.find((account: { scope: string }) => account.scope === SCOPE_A).label = 'Renamed display label';
  writeFileSync(configPath, JSON.stringify(config, null, 4));
  const workspace = load();
  const restored = commitFilePlan(workspace, buildRestorePlan(workspace, basename(result.backup!)), () => undefined);
  expect(restored.verified).toBe(true);
  expect(load().snapshot.files).toEqual(before);
});

it('still refuses restore when an affected folder is no longer configured', () => {
  const { result } = operation('archive', [CHAT_A], [ID_A]);
  const configPath = join(root, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.accounts = config.accounts.filter((account: { scope: string }) => account.scope !== SCOPE_A);
  writeFileSync(configPath, JSON.stringify(config));
  expect(() => buildRestorePlan(load(), basename(result.backup!))).toThrow('claudesync-message:errorRestoreScope');
});

it('skips and reports symlink indexes and unknown schemas without treating them as managed sessions', () => {
  const relative = `${SCOPE_A}/local_${CHAT_A}.json`;
  editIndex(root, SCOPE_A, CHAT_A, { priorCliSessionIds: null });
  expect(load().snapshot.skippedPaths).toContain(relative);
  expect(load().entries.some((entry) => entry.path === relative)).toBe(false);
  editIndex(root, SCOPE_A, CHAT_A, { priorCliSessionIds: [] });
  const path = indexPath(root, SCOPE_A, CHAT_A);
  const raw = readFileSync(path); rmSync(path);
  const alternate = join(root, 'alternate.json'); writeFileSync(alternate, raw); symlinkSync(alternate, path);
  expect(load().snapshot.skippedPaths).toContain(relative);
  expect(load().entries.some((entry) => entry.path === relative)).toBe(false);
  expect(readFileSync(alternate)).toEqual(raw);
});

it('previews title conflicts and applies the user choice without unselected title changes', () => {
  editIndex(root, SCOPE_B, CHAT_A, { title: 'Another manual title', titleSource: 'user' });
  const workspace = load();
  const request: OperationRequest = { kind: 'sync', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] };
  const preview = buildOperationPlan(workspace, request);
  expect(preview.preview.conflicts).toHaveLength(1);
  const chosen = buildOperationPlan(workspace, { ...request, titleSelections: { [CHAT_A]: SCOPE_A } });
  commitFilePlan(workspace, chosen, () => undefined);
  expect(load().entries.filter((entry) => entry.data.cliSessionId === CHAT_A).every((entry) => entry.data.title === 'Shared manual title')).toBe(true);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_B))).toBe(false);
});
