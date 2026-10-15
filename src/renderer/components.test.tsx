import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { AccountSidebar, DeleteConfirmation, OperationReview, SessionRows } from './components';
import type { AccountView, SessionView } from '../shared/contracts';

const accounts: AccountView[] = [{ id: 'a', email: 'fixture@example.com', scopes: ['a/org'], active: 10, archived: 2, total: 12, eligible: 10, copies: 20, current: true }];
const sessions: SessionView[] = [{ id: 'chat', title: 'Chosen session', project: '/fixture/project', manageable: true, starred: false,
  presence: [{ accountId: 'a', active: true, archived: false, eligible: true, copies: 2, titles: ['Chosen session'], reasons: [] }] }];
const noop = () => undefined;

it.each([
  ['active', '再使用“归档”'], ['archived', '想保留归档内容'], ['mixed', '既有普通聊天'],
] as const)('explains %s deletion with the right alternative, explicit account and no preview or backup promise', (state, advice) => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(DeleteConfirmation,
    { count: 3, accountNames: ['fixture@example.com'], state, busy: false, onClose: noop, onDelete: noop }) }));
  expect(html).toContain('确定要删除这 3 条聊天吗');
  expect(html).toContain('fixture@example.com');
  expect(html).toContain(advice);
  expect(html).toContain('不留删除备份');
  expect(html).toContain('确定删除');
  expect(html).not.toContain('删除所选入口');
  expect(html).not.toContain('预览');
  expect(html).not.toContain('先备份');
});

it('renders readable account counts, named session checkboxes and the exact retained set in review', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement('div', null,
    createElement(AccountSidebar, { accounts, included: new Set(['a']), currentFilter: 'all', onInclude: noop, onFilter: noop, busy: false }),
    createElement(SessionRows, { sessions, accounts, selected: new Set(['chat']), included: new Set(['a']), filterId: 'all', onToggle: noop, busy: false }),
    createElement(OperationReview, { accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop,
      preview: { kind: 'keep', token: 'fixture', accountIds: ['a'], selected: [{ id: 'chat', title: 'Chosen session' }], changes: [], conflicts: [], skipped: [], fileCount: 0 } }),
  ) }));
  expect(html).toContain('10 条本机聊天');
  expect(html).toContain('2 条本机归档');
  expect(html).toContain('for="session-chat"');
  expect(html).toContain('已选 1 条聊天');
  expect(html).toContain('fixture@example.com');
  expect(html).not.toContain('43 条可检查');
});
