import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { termTips, type HelpTerm } from '../term-copy';
import { i18n, locales } from '../i18n';
import { I18nProvider } from './i18n';
import { AccountSidebar, CollapsedSessionGroup } from './components';
import { TermTip } from './TermTip';
import type { AccountView } from '../shared/contracts';
const noop = () => undefined;
const account: AccountView = { id: 'synthetic', scopes: [], active: 4, visible: 4, organizationVerified: true,
  total: 14, archived: 2, scheduled: 7, oldCopies: 10, deletedMarkers: 1, unverified: 0, eligible: 4, copies: 24, current: true };

it.each(locales)('%s uses the UIKit native help button for all nine terms', (locale) => {
  for (const term of Object.keys(termTips) as HelpTerm[]) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(TermTip, { term }) }));
    expect(html).toContain('class="game-ui-help-trigger"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label=');
    expect(html).not.toContain('tabindex="-1"');
    expect(html).not.toContain('game-ui-help-tip'); // No permanently visible explanation.
  }
});
it('keeps help controls outside account selection buttons and checkboxes', () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(AccountSidebar, {
    accounts: [account, { ...account, id: 'unverified', visible: null, organizationVerified: false }], included: new Set(['synthetic']),
    currentFilter: 'all', onInclude: noop, onFilter: noop, busy: false,
  }) }));
  expect(html).toContain('4 条普通会话');
  expect(html).not.toContain('sidebar-tip');
  for (const match of html.matchAll(/<button[^>]*class="account-open"[^>]*>(.*?)<\/button>/gu)) {
    expect(match[1]).not.toContain('<button');
    expect(match[1]).not.toContain('game-ui-help-trigger');
  }
  expect(html).toContain('data-help-term="unknownEmail"');
  expect(html).toContain('data-help-term="unverified"');
});
it('keeps every right-hand help button outside the disclosure summary', () => {
  for (const group of ['archived', 'scheduled', 'oldOrganization', 'deleted', 'unverified'] as const) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'en', children: createElement(CollapsedSessionGroup, {
      group, sessions: [], accounts: [account], selected: new Set<string>(), filterId: 'all', included: new Set(['synthetic']),
      onToggle: noop, onCollapse: noop, busy: false,
    }) }));
    expect(html.match(/<summary>(.*?)<\/summary>/u)?.[1]).not.toContain('<button');
    expect(html).toContain(`data-help-term="${group}"`);
    expect(html).not.toContain(i18n.translator('en').t(termTips[group].body));
  }
});
