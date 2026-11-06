import { expect, it } from 'vitest';
import type { SessionCopyView, SessionView } from '../shared/contracts';
import { selectedSourceAccountIds, sessionActionState } from './session-action-state';
import { sessionsInGroup } from './session-groups';
import { filterSessions } from './session-selection';

const record = (overrides: Partial<SessionCopyView> = {}): SessionCopyView => ({
  scope: 'fixture/current', group: 'visible', title: 'Synthetic session', project: '/fixture',
  archived: false, eligible: true, manageable: true, starred: false, reasons: [], ...overrides,
});
const row = (items: Array<[string, SessionCopyView[] | undefined]>, overrides: Partial<SessionView> = {}): SessionView => ({
  id: 'synthetic', title: 'Synthetic session', project: '/fixture', starred: false,
  manageable: false, deletable: false,
  presence: items.map(([accountId, records]) => ({
    accountId, active: true, archived: false, eligible: true, copies: records?.length ?? 1,
    titles: [], reasons: [], ...(records === undefined ? {} : { records }),
  })), ...overrides,
});
const none = { manageable: false, deletable: false, eligible: false, hasSource: false };

it('ignores unsupported copies in excluded accounts', () => {
  const session = row([['a', [record()]], ['b', [record({ manageable: false, deletable: false })]]]);
  expect(sessionActionState(session, new Set(['a'])))
    .toEqual({ manageable: true, deletable: true, eligible: true, hasSource: true });
});

it('requires every participating copy to support an action', () => {
  const session = row([['a', [record()]], ['b', [record({ manageable: false, deletable: false })]]]);
  expect(sessionActionState(session, new Set(['a', 'b'])))
    .toEqual({ manageable: false, deletable: false, eligible: true, hasSource: true });
});

it('fails closed when no included account has a presence', () => {
  expect(sessionActionState(row([['a', [record()]]]), new Set(['b']))).toEqual(none);
  expect(sessionActionState(row([]), new Set(['a']))).toEqual(none);
});

it('does not fall back to aggregate flags for an explicit empty record list', () => {
  const session = row([['a', []]], { manageable: true, deletable: true });
  expect(sessionActionState(session, new Set(['a']))).toEqual(none);
  const mixed = row([['a', []], ['b', [record()]]], { manageable: true, deletable: true });
  expect(sessionActionState(mixed, new Set(['a', 'b'])))
    .toEqual({ manageable: false, deletable: false, eligible: true, hasSource: true });
});

it('does not borrow source eligibility from an excluded account', () => {
  const session = row([['a', [record({ eligible: false })]], ['b', [record()]]]);
  expect(sessionActionState(session, new Set(['a'])))
    .toEqual({ manageable: true, deletable: true, eligible: false, hasSource: true });
});

it('uses only the category records supplied by group projection', () => {
  const session = row([['a', [record(), record({
    group: 'scheduled', manageable: false, deletable: true, eligible: false,
  })]]]);
  const included = new Set(['a']);
  const ordinary = sessionsInGroup([session], 'visible', 'all', included)[0]!;
  const scheduled = sessionsInGroup([session], 'scheduled', 'all', included)[0]!;
  expect(sessionActionState(ordinary, included))
    .toEqual({ manageable: true, deletable: true, eligible: true, hasSource: true });
  expect(sessionActionState(scheduled, included))
    .toEqual({ manageable: false, deletable: true, eligible: false, hasSource: true });
});

it('preserves the legacy aggregate fallback only when records are absent', () => {
  const legacy = row([['a', undefined]], { manageable: true, deletable: false });
  const included = new Set(['a']);
  expect(sessionActionState(legacy, included))
    .toEqual({ manageable: true, deletable: false, eligible: true, hasSource: true });
  delete legacy.deletable;
  legacy.presence[0]!.eligible = false;
  expect(sessionActionState(legacy, included))
    .toEqual({ manageable: true, deletable: true, eligible: false, hasSource: true });
});

it('checks all records inside one participating account', () => {
  const session = row([['a', [record(), record({ manageable: false, deletable: false })]]]);
  expect(sessionActionState(session, new Set(['a'])))
    .toEqual({ manageable: false, deletable: false, eligible: true, hasSource: true });
});

it('counts distinct included source accounts, not records or unselected destinations', () => {
  const sessions = [
    row([['a', [record(), record()]], ['b', [record()]], ['excluded', [record()]]], { id: 'one' }),
    row([['a', [record()]]], { id: 'two' }),
    row([['c', [record()]]], { id: 'unselected' }),
  ];
  const ids = selectedSourceAccountIds(sessions, new Set(['one', 'two']), new Set(['a', 'b', 'c']));
  expect([...ids].sort()).toEqual(['a', 'b']);
});

it('keeps a single source separate from two included destination accounts', () => {
  const sessions = [row([['a', [record()]]], { id: 'one' })];
  expect([...selectedSourceAccountIds(sessions, new Set(['one']), new Set(['a', 'b', 'c']))])
    .toEqual(['a']);
});

it('counts source records only in the selected group, including archived copies', () => {
  const session = row([['a', [record()]], ['b', [record({
    group: 'archived', archived: true, eligible: false,
  })]], ['c', [record({ group: 'oldOrganization' })]]]);
  const included = new Set(['a', 'b', 'c']);
  const selected = new Set([session.id]);
  const archived = sessionsInGroup([session], 'archived', 'all', included);
  expect([...selectedSourceAccountIds(archived, selected, included)]).toEqual(['b']);
});

it('includes selected sources hidden by search', () => {
  const sessions = [
    row([['a', [record()]]], { id: 'shown', title: 'Shown session' }),
    row([['b', [record()]]], { id: 'hidden', title: 'Hidden session' }),
  ];
  const included = new Set(['a', 'b']);
  const visible = filterSessions(sessions, {
    accountId: 'all', included, filter: 'all', search: 'Shown', sort: 'updated',
  });
  expect(visible.map((session) => session.id)).toEqual(['shown']);
  expect([...selectedSourceAccountIds(sessions, new Set(['shown', 'hidden']), included)].sort())
    .toEqual(['a', 'b']);
});

it('counts the full group independently of a single-account Viewing projection', () => {
  const sessions = [row([['a', [record()]], ['b', [record()]]])];
  const included = new Set(['a', 'b', 'c']);
  expect(sessionsInGroup(sessions, 'visible', 'a', included)[0]!.presence).toHaveLength(1);
  const fullGroup = sessionsInGroup(sessions, 'visible', 'all', included);
  expect([...selectedSourceAccountIds(fullGroup, new Set(['synthetic']), included)].sort())
    .toEqual(['a', 'b']);
});

it('omits empty record lists and supports legacy recordless source presence', () => {
  const sessions = [row([['empty', []], ['legacy', undefined]])];
  const included = new Set(['empty', 'legacy']);
  expect([...selectedSourceAccountIds(sessions, new Set(['synthetic']), included)]).toEqual(['legacy']);
  expect(selectedSourceAccountIds(sessions, new Set(), included).size).toBe(0);
});
