import { expect, it } from 'vitest';
import { filterSessions } from './session-selection';
import type { SessionView } from '../shared/contracts';

const sessions: SessionView[] = [{
  id: 'chat-one', title: 'Original title', project: '/project/Alpha', manageable: true, starred: false,
  presence: [{ accountId: 'a', active: false, archived: true, eligible: false, copies: 2, reasons: [], titles: ['A different name'] },
    { accountId: 'b', active: true, archived: false, eligible: true, copies: 1, reasons: [], titles: ['Original title'] }],
}];
const defaults = { accountId: 'all', included: new Set(['a']), filter: 'active' as const, search: '', sort: 'updated' as const };

it('filters by the chosen account state rather than another account active copy', () => {
  expect(filterSessions(sessions, defaults)).toHaveLength(0);
  expect(filterSessions(sessions, { ...defaults, filter: 'archived' })).toHaveLength(1);
  expect(filterSessions(sessions, { ...defaults, accountId: 'b' })).toHaveLength(1);
});

it('searches alternate titles and project names, and excludes unchecked accounts from the union', () => {
  expect(filterSessions(sessions, { ...defaults, filter: 'all', search: 'different' })).toHaveLength(1);
  expect(filterSessions(sessions, { ...defaults, filter: 'all', search: 'alpha' })).toHaveLength(1);
  expect(filterSessions(sessions, { ...defaults, filter: 'all', included: new Set() })).toHaveLength(0);
});
