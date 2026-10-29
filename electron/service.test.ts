import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { basename, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { addScope, CHAT_A, CHAT_B, ID_A, ID_B, SCOPE_A, SCOPE_B, editIndex, indexPath, temporaryFixture } from '../tests/fixture';
import type { DesktopIdentityCheck } from './desktop-identity';

const environment = vi.hoisted(() => ({ root: '', blocked: false }));
const desktop = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('./desktop-identity', async (importOriginal) => ({
  ...await importOriginal<typeof import('./desktop-identity')>(), checkDesktopIdentity: desktop.check,
}));
vi.mock('electron', () => ({ app: { getPath: () => environment.root } }));
vi.mock('./processes', () => ({
  processBlockers: () => environment.blocked ? ['Claude is running'] : [],
  assertClaudeStopped: () => { if (environment.blocked) throw new Error('Claude is running'); },
}));
import { applyOperation, availableBackups, checkWorkspace, cleanupOldCopies, deleteSelected, previewOldCopies, previewOperation, previewRestore } from './service';
import { configureFolders, rememberIdentities } from './accounts';

const deleteTrash = async (path: string) => {
  const directory = join(environment.root, 'delete-trash');
  mkdirSync(directory, { recursive: true });
  renameSync(path, join(directory, `${readdirSync(directory).length}-${basename(path)}`));
};

beforeEach(() => {
  environment.root = temporaryFixture(); environment.blocked = false;
  desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck);
  writeFileSync(join(environment.root, 'account-identities.json'), JSON.stringify({
    [ID_A]: { email: 'fixture@example.com', organizationId: SCOPE_A.split('/')[1] },
    [ID_B]: { email: 'other@example.com', organizationId: SCOPE_B.split('/')[1] },
  }));
});
afterEach(() => { rmSync(environment.root, { recursive: true, force: true }); });

it('deletes selected old-only copies even when an unrelated session changed after the displayed check', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(environment.root, oldScope, SCOPE_A);
  rmSync(indexPath(environment.root, oldScope, CHAT_A));
  rmSync(indexPath(environment.root, SCOPE_A, CHAT_B));
  const view = await checkWorkspace();
  editIndex(environment.root, SCOPE_A, CHAT_A, { title: 'Unrelated work continued' });
  writeFileSync(join(environment.root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"unrelated new turn"}}\n');
  const result = await deleteSelected({ group: 'oldOrganization', sessionIds: [CHAT_B], accountIds: [ID_A] }, view.revision, deleteTrash);
  expect(result.result.verified).toBe(true);
  expect(result.workspace.sessions.some((session) => session.id === CHAT_B)).toBe(false);
  expect(JSON.parse(readFileSync(indexPath(environment.root, SCOPE_A, CHAT_A), 'utf8')).title).toBe('Unrelated work continued');
});

it('previews and confirms old-copy cleanup despite unrelated transcript and index updates', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(environment.root, oldScope, SCOPE_A);
  rmSync(indexPath(environment.root, oldScope, CHAT_A));
  const view = await checkWorkspace();
  editIndex(environment.root, SCOPE_A, CHAT_A, { title: 'Unrelated before preview' });
  const preview = previewOldCopies([ID_A], view.revision);
  writeFileSync(join(environment.root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"unrelated continued"}}\n');
  editIndex(environment.root, SCOPE_B, CHAT_A, { title: 'Unrelated after preview' });
  const trashFolder = join(environment.root, 'fake-trash'); mkdirSync(trashFolder);
  const result = await cleanupOldCopies(preview.token, async (path) => renameSync(path, join(trashFolder, basename(path))));
  expect(result.result).toEqual({ trashed: 1, importedArchived: 0, mainUnchanged: true, oldCopiesRemaining: 0 });
});

it('names the selected old session and tells the user what to close when its own data changed', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(environment.root, oldScope, SCOPE_A);
  rmSync(indexPath(environment.root, oldScope, CHAT_A));
  editIndex(environment.root, oldScope, CHAT_B, { title: 'Selected old project' });
  const view = await checkWorkspace();
  const preview = previewOldCopies([ID_A], view.revision);
  editIndex(environment.root, oldScope, CHAT_B, { completedTurns: 99 });
  const trash = vi.fn();
  await expect(cleanupOldCopies(preview.token, trash)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
  expect(trash).not.toHaveBeenCalled();
});

it('previews every old duplicate, uses Trash only on confirm and reads back unchanged main count', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(environment.root, oldScope, SCOPE_A);
  const view = await checkWorkspace();
  const preview = previewOldCopies([ID_A], view.revision);
  expect(preview).toMatchObject({ trashCount: 2, archivedToImport: 0 });
  expect(preview.items.every((item) => item.currentHasCopy)).toBe(true);
  const trashFolder = join(environment.root, 'fake-trash');
  mkdirSync(trashFolder);
  let moved = 0;
  const result = await cleanupOldCopies(preview.token, async (path) => {
    renameSync(path, join(trashFolder, String(++moved) + '-' + path.split('/').at(-1)!));
  });
  expect(result.result).toEqual({ trashed: 2, importedArchived: 0, mainUnchanged: true, oldCopiesRemaining: 0 });
  expect(result.workspace.accounts.find((a) => a.id === ID_A)).toMatchObject({ visible: 2, oldCopies: 0 });
  expect(readdirSync(trashFolder)).toHaveLength(2);
  await expect(cleanupOldCopies(preview.token, async () => {})).rejects.toThrow('claudesync-message:errorOldCopyPreviewExpired');
});
it('does not trash anything when writers are running or the organization has changed', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(environment.root, oldScope, SCOPE_A);
  const view = await checkWorkspace();
  const preview = previewOldCopies([ID_A], view.revision);
  environment.blocked = true;
  await expect(cleanupOldCopies(preview.token, async () => { throw new Error('Never called'); })).rejects.toThrow('Claude is running');
  environment.blocked = false;
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).toContain('local_' + CHAT_A + '.json');
  const fresh = await checkWorkspace();
  const second = previewOldCopies([ID_A], fresh.revision);
  rememberIdentities([], { accountId: ID_A, email: 'fixture@example.com', organizationId: oldScope.split('/')[1] });
  await expect(cleanupOldCopies(second.token, async () => { throw new Error('Never called'); })).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).toContain('local_' + CHAT_A + '.json');
});
it('rejects an organization change after preview without any backup or session write', async () => {
  const view = await checkWorkspace();
  const preview = previewOperation({ kind: 'sync', group: 'visible', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] }, view.revision);
  const before = readFileSync(indexPath(environment.root, SCOPE_A, CHAT_B));
  rememberIdentities([], { accountId: ID_B, email: 'other@example.com', organizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  await expect(applyOperation(preview.token)).rejects.toThrow('claudesync-message:errorOrganizationChanged');
  expect(readFileSync(indexPath(environment.root, SCOPE_A, CHAT_B))).toEqual(before);
  expect(availableBackups()).toHaveLength(0);
  expect(() => previewOperation({ kind: 'sync', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] }, view.revision)).toThrow('claudesync-message:errorWorkspaceRevisionChanged');
});

it('reports an email-only account as unverified and explains the blocked destination', async () => {
  writeFileSync(join(environment.root, 'account-identities.json'), JSON.stringify({
    [ID_A]: { email: 'fixture@example.com', organizationId: SCOPE_A.split('/')[1] }, [ID_B]: 'other@example.com',
  }));
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_B)).toMatchObject({ visible: null, organizationVerified: false });
  expect(() => previewOperation({ kind: 'sync', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] }, view.revision)).toThrow('claudesync-message:errorOrganizationUnverified');
  expect(() => previewOperation({ kind: 'archive', group: 'invalid', sessionIds: [CHAT_A], accountIds: [ID_A] }, view.revision)).toThrow('claudesync-message:errorInvalidSessionGroup');
});

it('uses a single-use preview token and provides a restore preview through the application service', async () => {
  const initial = await checkWorkspace();
  const preview = previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] }, initial.revision);
  expect(preview.changes).toHaveLength(2);
  const result = await applyOperation(preview.token);
  expect(result.result.verified).toBe(true);
  await expect(applyOperation(preview.token)).rejects.toThrow('claudesync-message:errorPreviewExpired');
  const restore = previewRestore(basename(result.result.backup!), result.workspace.revision);
  const restored = await applyOperation(restore.token);
  expect(restored.workspace.sessions.find((session) => session.id === CHAT_A)?.presence.every((presence) => presence.active)).toBe(true);
  expect(availableBackups()).toHaveLength(2);
});

it('rejects stale requests and consumes a blocked token without changing session data', async () => {
  const initial = await checkWorkspace();
  editIndex(environment.root, SCOPE_A, CHAT_A, { title: 'New work' });
  expect(() => previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).toThrow('claudesync-message:errorWorkspaceRevisionChanged');
  const fresh = await checkWorkspace();
  const preview = previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] }, fresh.revision);
  environment.blocked = true;
  await expect(applyOperation(preview.token)).rejects.toThrow('Claude is running');
  await expect(applyOperation(preview.token)).rejects.toThrow('claudesync-message:errorPreviewExpired');
  expect((await checkWorkspace()).sessions.some((session) => session.id === CHAT_A)).toBe(true);
  expect(() => previewOperation({ kind: 'unknown', sessionIds: [CHAT_A], accountIds: [ID_A] }, fresh.revision)).toThrow('claudesync-message:errorInvalidOperationParams');
});

it('executes only the confirmed local deletion scope without a preview, backup or restore token', async () => {
  const initial = await checkWorkspace();
  expect(() => previewOperation({ kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).toThrow('claudesync-message:errorDeleteConfirmation');
  const result = await deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision, deleteTrash);
  expect(result.result).toMatchObject({ verified: true });
  expect(result.result.backup).toBeUndefined();
  expect(result.workspace.sessions.find((session) => session.id === CHAT_A)?.presence.map((item) => item.accountId)).toEqual([ID_B]);
  expect(availableBackups()).toEqual([]);
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision, deleteTrash)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
});

it('blocks a direct deletion when Claude is running or the confirmed list has changed', async () => {
  const initial = await checkWorkspace();
  environment.blocked = true;
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision, deleteTrash)).rejects.toThrow('Claude is running');
  environment.blocked = false;
  editIndex(environment.root, SCOPE_A, CHAT_A, { isArchived: true });
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision, deleteTrash)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
  expect(availableBackups()).toEqual([]);
});

it('uses the verified organization for counts and management rather than letting old active copies override archives', async () => {
  const oldScope = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(environment.root, oldScope, SCOPE_A);
  editIndex(environment.root, SCOPE_A, CHAT_A, { isArchived: true });
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_A, email: 'desktop@example.com', organizationId: SCOPE_A.split('/')[1] } } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ visible: 1, active: 1, archived: 1, oldCopies: 2, scopes: [SCOPE_A, oldScope] });
  const restore = previewOperation({ kind: 'unarchive', group: 'archived', sessionIds: [CHAT_A], accountIds: [ID_A] }, view.revision);
  expect(restore.changes).toHaveLength(1);
  desktop.check.mockResolvedValue({ state: 'unavailable' });
  expect((await checkWorkspace()).accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 1, archived: 1, current: false });
  await expect(deleteSelected({ group: 'archived', sessionIds: [CHAT_A], accountIds: [ID_A] }, view.revision, deleteTrash)).rejects.toThrow('claudesync-message:errorSharedHistoryDelete');
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).toContain(`local_${CHAT_A}.json`);
  expect(readFileSync(indexPath(environment.root, SCOPE_B, CHAT_A)).length).toBeGreaterThan(0);
});

it('keeps a cleaned account empty after a cloud profile pins its organization and Desktop switches away', async () => {
  const oldScope = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(environment.root, oldScope, SCOPE_A);
  writeFileSync(join(environment.root, 'account-identities.json'), JSON.stringify({ [ID_A]: 'fixture@example.com' }));
  rememberIdentities([], { accountId: ID_A, email: 'fixture@example.com', organizationId: SCOPE_A.split('/')[1] });
  rmSync(indexPath(environment.root, SCOPE_A, CHAT_A));
  rmSync(indexPath(environment.root, SCOPE_A, CHAT_B));
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_B, email: 'other@example.com', organizationId: SCOPE_B.split('/')[1] } } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ email: 'fixture@example.com', visible: 0, active: 0, archived: 0, total: 2, oldCopies: 2, current: false, scopes: [SCOPE_A, oldScope] });
  expect(view.accounts.find((account) => account.id === ID_B)?.current).toBe(true);
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).toContain(`local_${CHAT_A}.json`);
  expect(JSON.parse(readFileSync(join(environment.root, 'account-identities.json'), 'utf8'))[ID_A]).toEqual({ email: 'fixture@example.com', organizationId: SCOPE_A.split('/')[1] });
});

it('keeps CLI history separate from the verified current Desktop account and saves only email bindings', async () => {
  rmSync(join(environment.root, 'account-identities.json'));
  writeFileSync(join(environment.root, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ID_A, emailAddress: 'fixture@example.com', unrelatedToken: 'not-a-real-secret' } }));
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_B, email: 'desktop@example.com' } } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ email: 'fixture@example.com', current: false });
  expect(view.accounts.find((account) => account.id === ID_B)).toMatchObject({ email: 'desktop@example.com', current: true });
  expect(JSON.parse(readFileSync(join(environment.root, 'account-identities.json'), 'utf8'))).toEqual({ [ID_A]: 'fixture@example.com', [ID_B]: 'desktop@example.com' });
  expect(view.sessions.some((session) => session.id === CHAT_B)).toBe(true);
  desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck);
  const unavailable = await checkWorkspace();
  expect(unavailable.accounts.every((account) => !account.current)).toBe(true);
  expect(unavailable.accounts.find((account) => account.id === ID_B)?.email).toBe('desktop@example.com');
  expect(unavailable.sessions).toEqual(view.sessions);
});

it('retains configured account exclusions when saving the same folder again', async () => {
  const path = join(environment.root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.slice(0, 1);
  writeFileSync(path, JSON.stringify(config));
  configureFolders(join(environment.root, 'session-root'), join(environment.root, 'projects'));
  expect((await checkWorkspace()).accounts.map((account) => account.id)).toEqual([ID_A]);
});

it('includes a previously omitted verified Desktop account and observes its native archive changes on refresh', async () => {
  const path = join(environment.root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.slice(0, 1);
  const original = JSON.stringify(config);
  writeFileSync(path, original);
  const unrelated = '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  mkdirSync(join(environment.root, 'session-root', unrelated), { recursive: true });
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_B, email: 'new@example.com' } } satisfies DesktopIdentityCheck);
  const before = await checkWorkspace();
  expect(before.accounts.find((account) => account.id === ID_B)).toMatchObject({ email: 'new@example.com', current: true, active: 1, archived: 0 });
  const saved = readFileSync(path, 'utf8');
  expect(JSON.parse(saved).accounts).toHaveLength(2);
  const backup = readdirSync(join(environment.root, 'backups')).find((name) => name.startsWith('config-'))!;
  expect(readFileSync(join(environment.root, 'backups', backup), 'utf8')).toBe(original);
  expect((await checkWorkspace()).accounts).toEqual(before.accounts);
  expect(readFileSync(path, 'utf8')).toBe(saved);
  writeFileSync(join(environment.root, 'session-root', SCOPE_B, 'archived-sessions.idx'), JSON.stringify({ v: 1, archived: [`local_${CHAT_A}`] }));
  const refreshed = await checkWorkspace();
  expect(refreshed.accounts.find((account) => account.id === ID_B)).toMatchObject({ active: 0, archived: 1 });
  expect(refreshed.accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 2, archived: 0 });
  expect(refreshed.revision).not.toBe(before.revision);
});

it('preserves a previously verified Desktop email when older CLI metadata still exists', async () => {
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_A, email: 'verified@example.com' } } satisfies DesktopIdentityCheck);
  await checkWorkspace();
  writeFileSync(join(environment.root, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ID_A, emailAddress: 'stale@example.com' } }));
  desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ email: 'verified@example.com', current: false });
});

it('includes a newly discovered current account while reporting and skipping its unknown entries', async () => {
  const path = join(environment.root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.slice(0, 1);
  const original = JSON.stringify(config);
  writeFileSync(path, original);
  mkdirSync(join(environment.root, 'session-root', SCOPE_B, 'unknown'));
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_B, email: 'new@example.com' } } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.skippedPaths).toEqual([`${SCOPE_B}/unknown`]);
  expect(view.sessions.length).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(path, 'utf8')).accounts.map((account: { scope: string }) => account.scope)).toEqual([SCOPE_A, SCOPE_B]);
  desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck);
  expect((await checkWorkspace()).accounts.map((account) => account.id)).toEqual([ID_A, ID_B]);
});
