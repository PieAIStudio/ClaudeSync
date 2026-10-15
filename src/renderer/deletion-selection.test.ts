import { expect, it } from 'vitest';
import type { SessionView } from '../shared/contracts';
import { deletionSelection } from './deletion-selection';

const shared: SessionView = { id: 'chat', title: 'Shared', project: '/fixture', manageable: true, starred: false,
  presence: [
    { accountId: 'gmail', active: false, archived: true, eligible: false, copies: 1, titles: [], reasons: [] },
    { accountId: 'apple', active: true, archived: false, eligible: true, copies: 1, titles: [], reasons: [] },
  ] };

it('deletes only the viewed account and uses its archive status even when another included account has an active copy', () => {
  expect(deletionSelection([shared], new Set(['chat']), new Set(['gmail', 'apple']), 'gmail'))
    .toEqual({ sessionIds: ['chat'], accountIds: ['gmail'], state: 'archived' });
  expect(deletionSelection([shared], new Set(['chat']), new Set(['gmail', 'apple']), 'apple').state).toBe('active');
});

it('summarizes mixed selections across included accounts and ignores unchecked accounts and stale selection IDs', () => {
  expect(deletionSelection([shared], new Set(['chat', 'stale']), new Set(['gmail', 'apple']), 'all'))
    .toEqual({ sessionIds: ['chat'], accountIds: ['gmail', 'apple'], state: 'mixed' });
  expect(deletionSelection([shared], new Set(['chat']), new Set(['gmail']), 'apple').sessionIds).toEqual([]);
});
