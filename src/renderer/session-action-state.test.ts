import { expect, it } from 'vitest';
import type { SessionCopyView, SessionView } from '../shared/contracts';
import { sessionActionState } from './session-action-state';
import { sessionsInGroup } from './session-groups';

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
