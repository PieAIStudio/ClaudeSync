import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { I18nProvider } from './i18n';
import { userMessage } from '../error-copy';
import { AccountSidebar, DeleteConfirmation, OperationReview, SessionRows, SkippedEntriesNotice } from './components';
import type { AccountView, SessionView } from '../shared/contracts';

const accounts: AccountView[] = [{ id: 'a', email: 'fixture@example.com', scopes: ['a/org'], active: 10, archived: 2, total: 12, eligible: 10, copies: 20, current: true, visible: 10, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 }];
const sessions: SessionView[] = [{ id: 'chat', title: 'Chosen session', project: '/fixture/project', manageable: true, starred: false,
  presence: [{ accountId: 'a', active: true, archived: false, eligible: true, copies: 2, titles: ['Chosen session'], reasons: [] }] }];
const noop = () => undefined;

it('reports skipped paths as unchanged under non-blocking attention, without hiding session controls', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement('div', null,
    createElement(SkippedEntriesNotice, { paths: ['account/organization/unknown', 'account/organization/link'] }),
    createElement(SessionRows, { sessions, accounts, selected: new Set<string>(), included: new Set(['a']), filterId: 'all', onToggle: noop, busy: false }),
  ) }));
  expect(html).toContain('需要注意');
  expect(html).toContain('account/organization/unknown：已跳过，未改动');
  expect(html).toContain('account/organization/link：已跳过，未改动');
  expect(html).toContain('Chosen session');
  expect(html).not.toContain('disabled=""');
  const empty = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(SkippedEntriesNotice, { paths: [] }) }));
  expect(empty).toBe('');
});

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
] as const)('explains %s deletion with the right alternative and explicit Trash recovery scope', (state, advice) => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(DeleteConfirmation,
    { count: 3, accountNames: ['fixture@example.com'], state, busy: false, onClose: noop, onDelete: noop }) }));
  expect(html).toContain('确定要删除这 3 条 Code 会话吗');
  expect(html).toContain('fixture@example.com');
  expect(html).toContain(advice);
  expect(html).toContain('废纸篓');
  expect(html).toContain('确定删除');
  expect(html).not.toContain('删除所选入口');
  expect(html).not.toContain('预览');
  expect(html).not.toContain('先备份');
});

it('explains where an archive goes and how to undo it before confirmation', () => {
  const preview = { kind: 'archive' as const, token: 'fixture', group: 'visible' as const, accountIds: ['a'],
    selected: [{ id: 'chat', title: 'Chosen session' }], changes: [{ sessionId: 'chat', title: 'Chosen session', accountId: 'a', action: 'archive' as const, copies: 1 }],
    conflicts: [], skipped: [], fileCount: 1 };
  const renderArchive = (locale: 'zh-CN' | 'en') => renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(OperationReview, {
    accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop, preview,
  }) }));
  expect(renderArchive('zh-CN')).toContain('已归档的聊天会移到“已归档”分组；要恢复，请在那里选中它并选择“取消归档”。');
  expect(renderArchive('en')).toContain('Archived chats move to the “Archived” group; to bring one back, select it there and choose “Unarchive selected.”');
});

it('explains where an unarchive goes and how to reverse it before confirmation', () => {
  const preview = { kind: 'unarchive' as const, token: 'fixture', group: 'archived' as const, accountIds: ['a'],
    selected: [{ id: 'chat', title: 'Chosen session' }], changes: [{ sessionId: 'chat', title: 'Chosen session', accountId: 'a', action: 'unarchive' as const, copies: 1 }],
    conflicts: [], skipped: [], fileCount: 1 };
  const renderUnarchive = (locale: 'zh-CN' | 'en') => renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(OperationReview, {
    accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop, preview,
  }) }));
  expect(renderUnarchive('zh-CN')).toContain('取消归档的聊天会回到“普通会话”列表；要再次收起，请在那里选中它并选择“归档所选”。');
  expect(renderUnarchive('en')).toContain('Unarchived chats return to the regular list; to hide one again, select it there and choose “Archive selected.”');
});

it('shows restore backup identity and keeps a blocked restore unconfirmable', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(OperationReview, {
    accounts, busy: false, blocked: false, onClose: noop, onApply: noop, onChooseTitle: noop,
    preview: { kind: 'restore', token: '', backup: { id: 'fixture-backup', createdAt: '2026-10-28T00:00:00.000Z', operation: 'sync', state: 'verified', fileCount: 1, affectedAccountIds: ['a'] },
      accountIds: ['a'], selected: [], changes: [], conflicts: [], skipped: [], fileCount: 0, blockedReason: userMessage('errorRestoreSessionChanged', { title: 'Chosen session' }) },
  }) }));
  expect(html).toContain('备份详情');
  expect(html).toContain('同步所选');
  expect(html).toContain('1 个文件');
  expect(html).toContain('恢复到原本机文件位置');
  expect(html).toContain('暂不能恢复：这条Code 会话后来又被修改过，不能覆盖：Chosen session');
  const confirm = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)?.find((button) => button.replace(/<[^>]*>/gu, '') === '确认执行');
  expect(confirm).toContain('disabled=""');
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
