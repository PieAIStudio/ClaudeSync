import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sidebarFixture, OLD_SCOPE, ORDINARY_IDS, syntheticId } from '../../tests/sidebar-fixture';
import { CHAT_A, CHAT_B, ID_A, ID_B, SCOPE_A, SCOPE_B, editIndex, indexPath, loadFixtureWorkspace } from '../../tests/fixture';
import { buildCatalog } from './catalog';
import { buildOperationPlan } from './operations';
import { buildPlan } from './planner';
import { loadWorkspace } from './workspace';
import { commitFilePlan, encodeJson, workspaceRevision } from './transaction';
import { entryGroup } from './visibility';

let root: string;
beforeEach(() => { root = sidebarFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const load = () => loadFixtureWorkspace(join(root, 'config.json'));

it('uses the actual scanner on the synthetic 4 / 2 / 7 / 10 / 1 structure, without changing its bytes', () => {
  const before = load();
  const catalog = buildCatalog(before, {}, ID_A);
  expect(catalog.accounts.find((account) => account.id === ID_A)).toMatchObject({
    visible: 4, active: 4, archived: 2, scheduled: 7, oldCopies: 10, deletedMarkers: 1,
    organizationVerified: true, unverified: 0, copies: 24,
  });
  expect(load().snapshot.files).toEqual(before.snapshot.files);
  console.info('SYNTHETIC_COUNTS', JSON.stringify(catalog.accounts.map((account, index) => ({
    account: index + 1, main: account.visible, archived: account.archived, scheduled: account.scheduled,
    oldCopies: account.oldCopies, deletedMarkers: account.deletedMarkers,
  }))));
});

it('does not invent verification from one folder, an email, or the number four', () => {
  const workspace = loadWorkspace(join(root, 'config.json'));
  const view = buildCatalog(workspace, { [ID_A]: 'synthetic@example.com' }, ID_A);
  expect(view.accounts.every((account) => account.visible === null && !account.organizationVerified)).toBe(true);
  expect(view.accounts.find((account) => account.id === ID_A)).toMatchObject({ active: 0, oldCopies: 0, unverified: 10 });
  expect(() => buildPlan(workspace.accounts, workspace.entries)).toThrow('claudesync-message:errorOrganizationUnverified');
  expect(() => buildOperationPlan(workspace, { kind: 'sync', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] })).toThrow('claudesync-message:errorOrganizationUnverified');
});

it('fails closed when the verified organization is missing from configured folders', () => {
  const workspace = load();
  workspace.verifiedOrganizations = { ...workspace.verifiedOrganizations, [ID_A]: syntheticId(999) };
  expect(buildCatalog(workspace).accounts.find((account) => account.id === ID_A)?.visible).toBeNull();
  expect(() => buildPlan(workspace.accounts, workspace.entries, { verifiedOrganizations: workspace.verifiedOrganizations })).toThrow('claudesync-message:errorOrganizationUnverified');
});

it('classifies by metadata, never by title, age, or single-turn length', () => {
  editIndex(root, SCOPE_A, CHAT_A, { title: 'Synthetic session', completedTurns: 1, scheduledTaskId: null });
  const workspace = load();
  expect(buildCatalog(workspace).accounts.find((account) => account.id === ID_A)?.visible).toBe(4);
  editIndex(root, SCOPE_A, CHAT_A, { scheduledTaskId: 123 });
  const skipped = load();
  expect(skipped.snapshot.skippedPaths).toEqual([`${SCOPE_A}/local_${CHAT_A}.json`]);
  expect(skipped.entries.some((entry) => entry.path === `${SCOPE_A}/local_${CHAT_A}.json`)).toBe(false);
  expect(buildCatalog(skipped).accounts.find((account) => account.id === ID_A)?.visible).toBe(3);
});

it('gives deletion precedence over scheduled and archive state without affecting other accounts', () => {
  editIndex(root, SCOPE_A, syntheticId(10), { isArchived: true });
  writeFileSync(join(root, 'session-root', SCOPE_A, `deleted_${syntheticId(10)}`), '0');
  writeFileSync(join(root, 'session-root', SCOPE_B, `deleted_${CHAT_A}`), '0');
  const workspace = load();
  expect(entryGroup(workspace, workspace.entries.find((entry) => entry.account.scope === SCOPE_A && entry.data.cliSessionId === syntheticId(10))!)).toBe('deleted');
  expect(buildCatalog(workspace).accounts.find((account) => account.id === ID_A)).toMatchObject({ visible: 4, scheduled: 6, archived: 2, deletedMarkers: 2 });
  expect(buildCatalog(workspace).accounts.find((account) => account.id === ID_B)?.visible).toBe(0);
});

it('honors deletion markers on prior history as well as the entry ID', () => {
  editIndex(root, SCOPE_A, CHAT_B, { priorCliSessionIds: [syntheticId(30)] });
  expect(buildCatalog(load()).accounts.find((account) => account.id === ID_A)?.visible).toBe(3);
});

it('never lets old unarchived copies override current archive state', () => {
  editIndex(root, SCOPE_A, CHAT_A, { isArchived: true });
  expect(buildCatalog(load()).accounts.find((account) => account.id === ID_A)).toMatchObject({ visible: 3, archived: 3, oldCopies: 10 });
});

it('can import an explicitly selected old copy but only into verified current organizations', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'sync', group: 'oldOrganization', sessionIds: [syntheticId(100)], accountIds: [ID_A, ID_B] });
  expect(plan.changes.filter((change) => change.action === 'add').map((change) => change.path.split('/').slice(0, 2).join('/')).sort()).toEqual([SCOPE_A, SCOPE_B]);
  expect(plan.changes.some((change) => change.path.startsWith(`${OLD_SCOPE}/`))).toBe(false);
  const before = readFileSync(indexPath(root, OLD_SCOPE, syntheticId(100)));
  commitFilePlan(workspace, plan, () => undefined);
  expect(readFileSync(indexPath(root, OLD_SCOPE, syntheticId(100)))).toEqual(before);
});

it('does not borrow an unselected old source when an archived group row is chosen for sync', () => {
  editIndex(root, SCOPE_A, CHAT_B, { isArchived: true });
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'sync', group: 'archived', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] });
  expect(plan.changes).toHaveLength(0);
  expect(plan.preview.skipped.some((item) => item.id === CHAT_B)).toBe(true);
  expect(load().snapshot.files).toEqual(workspace.snapshot.files);
});

it('can keep an explicit old source when a current counterpart is archived, without writing the old scope', () => {
  editIndex(root, SCOPE_A, CHAT_B, { isArchived: true });
  const workspace = load();
  const before = readFileSync(indexPath(root, OLD_SCOPE, CHAT_B));
  const plan = buildOperationPlan(workspace, { kind: 'keep', group: 'oldOrganization', sessionIds: [CHAT_B], accountIds: [ID_A, ID_B] });
  expect(plan.changes.some((change) => change.path.startsWith(`${OLD_SCOPE}/`))).toBe(false);
  commitFilePlan(workspace, plan, () => undefined);
  expect(readFileSync(indexPath(root, OLD_SCOPE, CHAT_B))).toEqual(before);
  expect(buildCatalog(load()).accounts.every((account) => account.visible === 1)).toBe(true);
});

it('keeps exactly four normal chats without archiving scheduled runs or writing old organizations', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'keep', group: 'visible', sessionIds: ORDINARY_IDS, accountIds: [ID_A, ID_B] });
  expect(plan.changes.every((change) => change.path.startsWith(`${SCOPE_A}/`) || change.path.startsWith(`${SCOPE_B}/`))).toBe(true);
  commitFilePlan(workspace, plan, () => undefined);
  const after = load();
  expect(buildCatalog(after).accounts.every((account) => account.visible === 4)).toBe(true);
  for (const [path, raw] of workspace.snapshot.files) {
    if (path.startsWith(`${OLD_SCOPE}/`) || path.includes(`local_${syntheticId(10)}`)) expect(after.snapshot.files.get(path)).toEqual(raw);
  }
  expect(buildCatalog(after).accounts.find((account) => account.id === ID_A)?.scheduled).toBe(7);
});

it('does not silently manage hidden old copies when the visible group is selected', () => {
  const workspace = load();
  const plan = buildOperationPlan(workspace, { kind: 'archive', group: 'visible', sessionIds: [CHAT_A], accountIds: [ID_A] });
  expect(plan.changes.every((change) => change.path.startsWith(`${SCOPE_A}/`))).toBe(true);
  expect(() => buildOperationPlan(workspace, { kind: 'delete', group: 'visible', sessionIds: [CHAT_A], accountIds: [ID_A] })).toThrow('claudesync-message:errorSharedHistoryDelete');
  const old = buildOperationPlan(workspace, { kind: 'archive', group: 'oldOrganization', sessionIds: [CHAT_A], accountIds: [ID_A] });
  expect(old.changes.every((change) => change.path.startsWith(`${OLD_SCOPE}/`))).toBe(true);
});

it('rejects forged sync plans to an old organization at the transaction boundary too', () => {
  const workspace = load();
  const entry = workspace.entries.find((item) => item.account.scope === OLD_SCOPE)!;
  expect(() => commitFilePlan(workspace, { kind: 'sync', changes: [{ path: entry.path, before: entry.raw,
    after: encodeJson({ ...entry.data, title: 'Forged' }), action: 'title', sessionId: entry.data.cliSessionId!, title: 'Forged' }] }, () => undefined)).toThrow('claudesync-message:errorUnverifiedPlan');
  expect(load().snapshot.files).toEqual(workspace.snapshot.files);
});

it('binds displayed revisions to organization verification, even when session bytes are unchanged', () => {
  const workspace = load();
  expect(workspaceRevision({ ...workspace, verifiedOrganizations: { ...workspace.verifiedOrganizations, [ID_A]: OLD_SCOPE.split('/')[1]! } })).not.toBe(workspaceRevision(workspace));
});
