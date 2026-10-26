import { basename, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { buildOperationPlan } from './operations';
import { buildRestorePlan, commitFilePlan, listBackups, workspaceRevision } from './transaction';
import { buildWorkspacePlan } from './workspace';
import { loadFixtureWorkspace as loadWorkspace } from '../../tests/fixture';
import { addScope, CHAT_A, CHAT_B, editIndex, ID_A, ID_B, indexPath, SCOPE_A, SCOPE_B, temporaryFixture } from '../../tests/fixture';
import type { OperationRequest } from '../shared/contracts';

let root: string;
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const load = () => loadWorkspace(join(root, 'config.json'));
function operation(kind: OperationRequest['kind'], sessionIds = [CHAT_A], accountIds = [ID_A, ID_B], title?: string) {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind, sessionIds, accountIds, title });
  const result = commitFilePlan(workspace, plan, () => undefined);
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

it('preserves native task backlog bytes through sync, archive, removal and restore', () => {
  const backlogPaths = [SCOPE_A, SCOPE_B].map((scope) => {
    const directory = join(root, 'session-root', scope, 'backlog');
    mkdirSync(directory);
    const path = join(directory, 'tasks.json');
    writeFileSync(path, `{"version":1,"items":[],"private":"${scope}"}\n`);
    return [path, readFileSync(path)] as const;
  });
  for (const kind of ['sync', 'archive', 'delete'] as const) {
    const { plan, result } = operation(kind, [CHAT_B]);
    expect(plan.changes.every((change) => !change.path.includes('/backlog/'))).toBe(true);
    if (kind === 'delete') expect(result.backup).toBeUndefined();
    else commitFilePlan(load(), buildRestorePlan(load(), basename(result.backup!)), () => undefined);
    for (const [path, raw] of backlogPaths) expect(readFileSync(path)).toEqual(raw);
  }
});

it.each(['empty', 'regular files'])('preserves native waiting-input with %s through sync, archive, removal and restore', (contents) => {
  const directories = [SCOPE_A, SCOPE_B].map((scope) => {
    const directory = join(root, 'session-root', scope, 'waiting-input');
    mkdirSync(directory);
    const raw = Buffer.from(`Opaque Desktop state: ${scope}\r\n\0`);
    if (contents === 'regular files') writeFileSync(join(directory, `local_${CHAT_B}.json`), raw);
    return { directory, raw };
  });
  for (const kind of ['sync', 'archive', 'delete'] as const) {
    const { plan, result } = operation(kind, [CHAT_B]);
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

it('deletes selected records and exclusive transcripts with native markers, without a backup or recovery data', () => {
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const { result } = operation('delete', [CHAT_A]);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_A))).toBe(false);
  expect(existsSync(bodyPath)).toBe(false);
  expect(buildWorkspacePlan(load()).additions).toHaveLength(1); // Only unrelated chat B.
  expect(result.backup).toBeUndefined();
  expect(existsSync(join(root, 'backups'))).toBe(false);
  expect(listBackups(root)).toEqual([]);
  expect(existsSync(join(root, 'project'))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});

it('keeps shared transcripts and unchecked accounts while deleting a selected account session', () => {
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const before = readFileSync(bodyPath);
  const other = readFileSync(indexPath(root, SCOPE_B, CHAT_A));
  operation('delete', [CHAT_A], [ID_A]);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(readFileSync(indexPath(root, SCOPE_B, CHAT_A))).toEqual(other);
  expect(readFileSync(bodyPath)).toEqual(before);
  expect(listBackups(root)).toEqual([]);
});

it('protects transcripts claimed by a login omitted entirely from configuration', () => {
  const omitted = '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, omitted, SCOPE_A);
  const path = join(root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.filter((account: { scope: string }) => account.scope !== omitted);
  writeFileSync(path, JSON.stringify(config));
  const bodyPath = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  const raw = readFileSync(bodyPath);
  operation('delete', [CHAT_A]);
  expect(readFileSync(bodyPath)).toEqual(raw);
  expect(existsSync(indexPath(root, omitted, CHAT_A))).toBe(true);
});

it('stops an interrupted direct delete with accurate partial status and no recovery copy', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] });
  let calls = 0;
  expect(() => commitFilePlan(workspace, plan, () => { if (++calls === 3) throw new Error('Interrupted'); })).toThrow('claudesync-message:errorDeleteInterrupted');
  expect(listBackups(root)).toEqual([]);
  expect(existsSync(join(root, 'backups'))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_B, CHAT_A))).toBe(true);
});

it('refuses deletion when its entry ID is shared history, leaving archive available', () => {
  editIndex(root, SCOPE_A, CHAT_B, { priorCliSessionIds: [CHAT_A] });
  expect(() => operation('delete', [CHAT_A], [ID_A])).toThrow('claudesync-message:errorSharedHistoryDelete');
  expect(existsSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_A}`))).toBe(false);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(true);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
  operation('archive', [CHAT_A], [ID_A]);
  expect(load().entries.find((entry) => entry.data.cliSessionId === CHAT_A && entry.account.scope === SCOPE_A)?.archived).toBe(true);
});

it('protects history claimed by an unconfigured sibling folder of the same login account', () => {
  const sibling = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(root, sibling, SCOPE_A);
  const path = join(root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.filter((account: { scope: string }) => account.scope !== sibling);
  writeFileSync(path, JSON.stringify(config));
  expect(() => operation('delete', [CHAT_A], [ID_A])).toThrow('claudesync-message:errorSharedHistoryDelete');
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

it('blocks stale previews, running-process guards and changed transcripts before mutation', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] });
  expect(() => commitFilePlan(workspace, plan, () => { throw new Error('Claude running'); })).toThrow('Claude running');
  editIndex(root, SCOPE_A, CHAT_A, { title: 'A newer title' });
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorWorkspaceChanged');
  const fresh = load();
  const newPlan = buildOperationPlan(fresh, { kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A] });
  writeFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"newer"}}\n');
  expect(() => commitFilePlan(fresh, newPlan, () => undefined)).toThrow('claudesync-message:errorDependencySessionChanged');
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
