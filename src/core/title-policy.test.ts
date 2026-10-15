import { expect, it } from 'vitest';
import { buildTitleActions } from './title-policy';
import type { Account, SessionEntry } from './types';

const accounts: Account[] = [
  { label: 'Account A', scope: '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  { label: 'Account B', scope: '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { label: 'Account C', scope: '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
];

function entries(titles: Array<{ title: string; source: string }>): SessionEntry[] {
  return titles.map((item, index) => ({
    account: accounts[index]!,
    path: `${accounts[index]!.scope}/local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json`,
    eligible: true,
    data: {
      sessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cliSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cwd: '/tmp',
      title: item.title,
      titleSource: item.source,
    },
  }));
}

it('deduplicates identical manual titles before deciding whether a choice is needed', () => {
  const actions = buildTitleActions(entries([
    { title: 'Chosen title', source: 'user' },
    { title: 'Chosen title', source: 'tool' },
    { title: 'Automatic title', source: 'auto' },
  ]));
  expect(actions.map((action) => [action.target.account.label, action.status])).toEqual([
    ['Account C', 'safe'],
  ]);
  expect(actions[0]?.data?.title).toBe('Chosen title');
});

it('requires an explicit account choice when manual titles disagree', () => {
  const rows = entries([
    { title: 'First title', source: 'user' },
    { title: 'Second title', source: 'tool' },
  ]);
  expect(buildTitleActions(rows).every((action) => action.status === 'conflict' && !action.data)).toBe(true);

  const selected = buildTitleActions(rows, { 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': accounts[1]!.scope });
  expect(selected.map((action) => [action.target.account.label, action.status])).toEqual([
    ['Account A', 'selected_source'],
    ['Account B', 'selected_target'],
  ]);
  expect(selected[0]?.data?.title).toBe('Second title');
});
