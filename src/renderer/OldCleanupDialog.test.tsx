import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { I18nProvider, locales } from './i18n';
import { OldCleanupDialog } from './OldCleanupDialog';
import type { OldCleanupPreview } from '../shared/contracts';

const preview: OldCleanupPreview = {
  token: 'synthetic-one-use', accountIds: ['fixture-account'], trashCount: 2, archivedToImport: 1,
  items: [
    { sessionId: 'synthetic-1', title: 'Fixture A', accountId: 'fixture-account', oldScope: 'fixture/old-one', currentHasCopy: true, action: 'trashDuplicate' },
    { sessionId: 'synthetic-2', title: 'Fixture B', accountId: 'fixture-account', oldScope: 'fixture/old-one', currentHasCopy: false, action: 'restoreArchived' },
  ],
};
const noop = () => undefined;
it.each(locales)('%s renders per-copy yes/no and reversible Trash decision before confirmation', (locale) => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(OldCleanupDialog, {
    preview, busy: false, blocked: false, onClose: noop, onConfirm: noop,
  }) }));
  const text = html.replace(/<[^>]*>/gu, ' ');
  expect(text).toContain('Fixture A');
  expect(text).toContain('Fixture B');
  expect(text).toContain('2');
  expect(text).toContain('1');
  expect(html).toContain('game-ui-help-trigger');
  expect(html).toContain('type="button"');
  expect(html).toContain('game-ui-button');
  expect(html).not.toMatch(/<input[^>]+/u);
});
it('blocks destructive confirm while Claude is open, but keeps the cancel action', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(OldCleanupDialog, {
    preview, busy: false, blocked: true, onClose: noop, onConfirm: noop,
  }) }));
  expect(html).toContain('完全退出 Claude');
  expect(html).toMatch(/<button disabled=[^>]*>[\s\S]*?确认清理 2 条旧副本<\/button>/u);
});
