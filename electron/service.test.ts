import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { basename, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { applyOperation, availableBackups, checkWorkspace, deleteSelected, previewOperation, previewRestore } from './service';
import { configureFolders, rememberIdentities } from './accounts';

beforeEach(() => { environment.root = temporaryFixture(); environment.blocked = false; desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck); });
afterEach(() => { rmSync(environment.root, { recursive: true, force: true }); });

it('uses a single-use preview token and provides a restore preview through the application service', async () => {
  const initial = await checkWorkspace();
  const preview = previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] }, initial.revision);
  expect(preview.changes).toHaveLength(2);
  const result = await applyOperation(preview.token);
  expect(result.result.verified).toBe(true);
  await expect(applyOperation(preview.token)).rejects.toThrow('过期');
  const restore = previewRestore(basename(result.result.backup!), result.workspace.revision);
  const restored = await applyOperation(restore.token);
  expect(restored.workspace.sessions.find((session) => session.id === CHAT_A)?.presence.every((presence) => presence.active)).toBe(true);
  expect(availableBackups()).toHaveLength(2);
});

it('rejects stale requests and consumes a blocked token without changing session data', async () => {
  const initial = await checkWorkspace();
  editIndex(environment.root, SCOPE_A, CHAT_A, { title: 'New work' });
  expect(() => previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).toThrow('已经变化');
  const fresh = await checkWorkspace();
  const preview = previewOperation({ kind: 'archive', sessionIds: [CHAT_A], accountIds: [ID_A] }, fresh.revision);
  environment.blocked = true;
  await expect(applyOperation(preview.token)).rejects.toThrow('Claude is running');
  await expect(applyOperation(preview.token)).rejects.toThrow('过期');
  expect((await checkWorkspace()).sessions.some((session) => session.id === CHAT_A)).toBe(true);
  expect(() => previewOperation({ kind: 'unknown', sessionIds: [CHAT_A], accountIds: [ID_A] }, fresh.revision)).toThrow('参数');
});

it('executes only the confirmed local deletion scope without a preview, backup or restore token', async () => {
  const initial = await checkWorkspace();
  expect(() => previewOperation({ kind: 'delete', sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).toThrow('确认窗口');
  const result = await deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision);
  expect(result.result).toMatchObject({ verified: true });
  expect(result.result.backup).toBeUndefined();
  expect(result.workspace.sessions.find((session) => session.id === CHAT_A)?.presence.map((item) => item.accountId)).toEqual([ID_B]);
  expect(availableBackups()).toEqual([]);
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).rejects.toThrow('已经变化');
});

it('blocks a direct deletion when Claude is running or the confirmed list has changed', async () => {
  const initial = await checkWorkspace();
  environment.blocked = true;
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).rejects.toThrow('Claude is running');
  environment.blocked = false;
  editIndex(environment.root, SCOPE_A, CHAT_A, { isArchived: true });
  await expect(deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, initial.revision)).rejects.toThrow('已经变化');
  expect(availableBackups()).toEqual([]);
});

it('uses the verified organization for counts and management rather than letting old active copies override archives', async () => {
  const oldScope = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  addScope(environment.root, oldScope, SCOPE_A);
  editIndex(environment.root, SCOPE_A, CHAT_A, { isArchived: true });
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_A, email: 'desktop@example.com', organizationId: SCOPE_A.split('/')[1] } } satisfies DesktopIdentityCheck);
  const view = await checkWorkspace();
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 1, archived: 1, scopes: [SCOPE_A] });
  const restore = previewOperation({ kind: 'unarchive', sessionIds: [CHAT_A], accountIds: [ID_A] }, view.revision);
  expect(restore.changes).toHaveLength(1);
  desktop.check.mockResolvedValue({ state: 'unavailable' });
  expect((await checkWorkspace()).accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 1, archived: 1, current: false });
  const deleted = await deleteSelected({ sessionIds: [CHAT_A], accountIds: [ID_A] }, view.revision);
  expect(deleted.workspace.sessions.find((session) => session.id === CHAT_A)?.presence.map((item) => item.accountId)).toEqual([ID_B]);
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).not.toContain(`local_${CHAT_A}.json`);
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
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ email: 'fixture@example.com', active: 0, archived: 0, total: 0, current: false, scopes: [SCOPE_A] });
  expect(view.accounts.find((account) => account.id === ID_B)?.current).toBe(true);
  expect(readdirSync(join(environment.root, 'session-root', oldScope))).toContain(`local_${CHAT_A}.json`);
  expect(JSON.parse(readFileSync(join(environment.root, 'account-identities.json'), 'utf8'))[ID_A]).toEqual({ email: 'fixture@example.com', organizationId: SCOPE_A.split('/')[1] });
});

it('keeps CLI history separate from the verified current Desktop account and saves only email bindings', async () => {
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

it('restores tool configuration if the newly discovered current account has an unsafe directory', async () => {
  const path = join(environment.root, 'config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.accounts = config.accounts.slice(0, 1);
  const original = JSON.stringify(config);
  writeFileSync(path, original);
  mkdirSync(join(environment.root, 'session-root', SCOPE_B, 'unknown'));
  desktop.check.mockResolvedValue({ state: 'verified', identity: { accountId: ID_B, email: 'new@example.com' } } satisfies DesktopIdentityCheck);
  await expect(checkWorkspace()).rejects.toThrow('非普通文件');
  expect(readFileSync(path, 'utf8')).toBe(original);
  desktop.check.mockResolvedValue({ state: 'unavailable' } satisfies DesktopIdentityCheck);
  expect((await checkWorkspace()).accounts.map((account) => account.id)).toEqual([ID_A]);
});
