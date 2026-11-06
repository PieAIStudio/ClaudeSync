import { expect, it } from 'vitest';
import type { AccountView, SessionCopyView, SessionGroup, SessionView, WorkspaceView } from '../shared/contracts';
import { summarizeAccounts } from './account-summary';

const account = (id: string, organizationVerified = true): AccountView => ({
  id, scopes: [id + '/current'], active: 0, archived: 0, total: 0, eligible: 0,
  copies: 0, current: false, visible: organizationVerified ? 0 : null,
  organizationVerified, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0,
});
const copy = (group: SessionGroup = 'visible', eligible = group === 'visible'): SessionCopyView => ({
  scope: 'fixture/current', group, title: 'Synthetic session', project: '/fixture',
  archived: group === 'archived', eligible, manageable: true, starred: false, reasons: [],
});
const session = (id: string, records: Array<[string, SessionCopyView[]]>): SessionView => ({
  id, title: 'Synthetic ' + id, project: '/fixture', starred: false, manageable: true,
  presence: records.map(([accountId, copies]) => ({
    accountId, active: true, archived: false, eligible: true,
    copies: copies.length, titles: [], reasons: [], records: copies,
  })),
});
const workspace = (accounts: AccountView[], sessions: SessionView[]): WorkspaceView => ({
  checkedAt: '2026-11-06T00:00:00.000Z', revision: 'synthetic',
  accounts, sessions, blockers: [], skippedPaths: [], identityState: 'unavailable',
});

it('has no missing copies before a workspace is checked', () => {
  const result = summarizeAccounts(undefined, new Set(['a']));
  expect(result.accounts).toEqual([]);
  expect(result.missingSessionIds.size).toBe(0);
  expect(result.missingCopies).toBe(0);
});

it('separates missing session identities from destination copies', () => {
  const view = workspace(['a', 'b', 'c'].map((id) => account(id)), [
    session('one', [['a', [copy(), copy()]]]),
    session('two', [['a', [copy()]], ['b', [copy()]]]),
  ]);
  const result = summarizeAccounts(view, new Set(['a', 'b', 'c']));
  expect(result.accounts.map(({ accountId, missingCount }) => [accountId, missingCount]))
    .toEqual([['a', 0], ['b', 1], ['c', 2]]);
  expect([...result.missingSessionIds].sort()).toEqual(['one', 'two']);
  expect([...result.accounts[1]!.missingSessionIds]).toEqual(['one']);
  expect(result.missingCopies).toBe(3);
});

it('recognizes a current archived copy as present and never uses it as a source', () => {
  const view = workspace([account('a'), account('b')], [
    session('present', [['a', [copy()]], ['b', [copy('archived', false)]]]),
    session('archived-only', [['a', [copy('archived', true)]]]),
  ]);
  const result = summarizeAccounts(view, new Set(['a', 'b']));
  expect(result.missingCopies).toBe(0);
  expect(result.missingSessionIds.size).toBe(0);
});

it.each(['scheduled', 'oldOrganization', 'deleted', 'unverified'] as const)(
  'does not treat %s records as an ordinary source or current destination copy', (group) => {
    const view = workspace([account('a'), account('b')], [
      session('ordinary', [['a', [copy()]], ['b', [copy(group, true)]]]),
      session('secondary-only', [['b', [copy(group, true)]]]),
    ]);
    const result = summarizeAccounts(view, new Set(['a', 'b']));
    expect([...result.missingSessionIds]).toEqual(['ordinary']);
    expect(result.accounts.map((item) => item.missingCount)).toEqual([0, 1]);
    expect(result.missingCopies).toBe(1);
  },
);

it('requires eligible ordinary record evidence instead of aggregate presence flags', () => {
  const legacy = session('recordless', [['a', [copy()]]]);
  delete legacy.presence[0]!.records;
  const result = summarizeAccounts(workspace([account('a'), account('b')], [
    session('ineligible', [['a', [copy('visible', false)]]]), legacy,
  ]), new Set(['a', 'b']));
  expect(result.missingCopies).toBe(0);
  expect(result.missingSessionIds.size).toBe(0);
});

it('limits comparison to participating verified accounts without inventing unknown counts', () => {
  const view = workspace([account('a'), account('b'), account('unknown', false), account('excluded')], [
    session('ordinary', [['a', [copy()]]]),
    session('unknown-source', [['unknown', [copy()]]]),
    session('excluded-source', [['excluded', [copy()]]]),
  ]);
  const result = summarizeAccounts(view, new Set(['a', 'b', 'unknown', 'absent']));
  expect(result.accounts.map(({ accountId, missingCount }) => [accountId, missingCount]))
    .toEqual([['a', 0], ['b', 1], ['unknown', null], ['excluded', 0]]);
  expect([...result.missingSessionIds]).toEqual(['ordinary']);
  expect(result.missingCopies).toBe(1);
  expect(result.accounts[2]!.missingSessionIds.size).toBe(0);
  expect(result.accounts[3]!.missingSessionIds.size).toBe(0);
});