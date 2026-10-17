import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { AccountSidebar, DeleteConfirmation, OperationReview, SessionRows } from './components';
import type { AccountView, SessionView } from '../shared/contracts';

const accounts: AccountView[] = [{ id: 'a', email: 'fixture@example.com', scopes: ['a/org'], active: 10, archived: 2, total: 12, eligible: 10, copies: 20, current: true, visible: 10, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 }];
const sessions: SessionView[] = [{ id: 'chat', title: 'Chosen session', project: '/fixture/project', manageable: true, starred: false,
  presence: [{ accountId: 'a', active: true, archived: false, eligible: true, copies: 2, titles: ['Chosen session'], reasons: [] }] }];
const noop = () => undefined;

it('describes explicit marker restoration as reviewable selection, never as restoring a deletion backup', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement('div', null,
    createElement(SessionRows, { sessions: [{ ...sessions[0]!, presence: [{ ...sessions[0]!.presence[0]!, eligible: false, reasons: ['会话曾被删除'] }] }],
      accounts, selected: new Set(['chat']), included: new Set(['a']), filterId: 'all', onToggle: noop, busy: false }),
    createElement(OperationReview, { accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop,
      preview: { kind: 'sync', token: 'fixture', accountIds: ['a'], selected: [{ id: 'chat', title: 'Chosen session' }],
        changes: [{ sessionId: 'chat', title: 'Chosen session', accountId: 'a', action: 'restore', copies: 1 }], conflicts: [], skipped: [], fileCount: 1 } }),
  ) }));
  expect(html).toContain('选择后核对');
  expect(html).toContain('解除这条会话的删除记录');
  expect(html).not.toContain('恢复这个备份');
  expect(html).not.toContain('暂不能同步');
});

it('does not expose raw native deletion-marker counts as session counts', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(AccountSidebar, {
    accounts: [{ ...accounts[0]!, deletedMarkers: 231 }], included: new Set(['a']), currentFilter: 'all', onInclude: noop, onFilter: noop, busy: false,
  }) }));
  expect(html).not.toContain('231');
  expect(html).not.toContain('删除标记');
});

it('shows source, destination and turn delta and blocks unresolved version conflicts', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(OperationReview, {
    accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop,
    preview: { kind: 'sync', token: 'fixture', accountIds: ['a'], selected: [], changes: [], conflicts: [], skipped: [], fileCount: 1,
      progressUpdates: [{ id: 'chat', title: 'Shared work', sourceAccountId: 'a', targetAccountId: 'b', deltaTurns: 7, selected: false }],
      progressConflicts: [{ id: 'branch', title: 'Two branches', resolved: false, options: [{ path: 'a/org/local.json', accountId: 'a', title: 'A', turns: 2 }] }],
    },
  }) }));
  expect(html).toContain('比目标多 7 轮');
  expect(html).toContain('fixture@example.com');
  expect(html).toContain('请选择要保留的账号版本');
  const confirm = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)?.find((button) => button.replace(/<[^>]*>/gu, '') === '确认执行');
  expect(confirm).toBeDefined();
  expect(confirm!.slice(0, confirm!.indexOf('>'))).toContain('disabled=""');
});

it.each([
  ['active', '再使用“归档”'], ['archived', '想保留归档内容'], ['mixed', '既有普通会话'],
] as const)('explains %s deletion with the right alternative, explicit account and no preview or backup promise', (state, advice) => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(DeleteConfirmation,
    { count: 3, accountNames: ['fixture@example.com'], state, busy: false, onClose: noop, onDelete: noop }) }));
  expect(html).toContain('确定要删除这 3 条 Code 会话吗');
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
  expect(html).toContain('10 条普通会话');
  expect(html).toContain('归档 2');
  expect(html).toContain('for="session-chat"');
  expect(html).toContain('已选 1 条 Code 会话');
  expect(html).toContain('fixture@example.com');
  expect(html).not.toContain('43 条可检查');
});
