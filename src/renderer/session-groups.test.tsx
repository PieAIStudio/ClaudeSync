import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sidebarFixture, OLD_SCOPE } from '../../tests/sidebar-fixture';
import { CHAT_A, ID_A, editIndex, loadFixtureWorkspace } from '../../tests/fixture';
import { buildCatalog } from '../core/catalog';
import { sessionsInGroup } from './session-groups';
import { deletionSelection } from './deletion-selection';
import { AccountSidebar, CollapsedSessionGroup } from './components';
import { I18nProvider, locales } from './i18n';

let root: string;
beforeEach(() => { root = sidebarFixture(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const noop = () => undefined;
const included = new Set([ID_A]);
const catalog = () => buildCatalog(loadFixtureWorkspace(join(root, 'config.json')));

it('projects four ordinary rows and keeps secondary categories independently inspectable', () => {
  const view = catalog();
  for (const [group, count] of [['visible', 4], ['archived', 2], ['scheduled', 7], ['oldOrganization', 10], ['deleted', 1], ['unverified', 0]] as const) {
    const rows = sessionsInGroup(view.sessions, group, ID_A, included);
    expect(rows).toHaveLength(count);
    expect(rows.flatMap((row) => row.presence.flatMap((item) => item.records ?? [])).every((record) => record.group === group)).toBe(true);
  }
});

it('does not leak a hidden copy title or active state into a selected group', () => {
  editIndex(root, OLD_SCOPE, CHAT_A, { title: 'Synthetic old copy only', isArchived: true });
  const view = catalog();
  const visible = sessionsInGroup(view.sessions, 'visible', ID_A, included).find((row) => row.id === CHAT_A)!;
  expect(visible.title).not.toBe('Synthetic old copy only');
  expect(visible.presence[0]?.copies).toBe(1);
  const old = sessionsInGroup(view.sessions, 'oldOrganization', ID_A, included).find((row) => row.id === CHAT_A)!;
  expect(old.title).toBe('Synthetic old copy only');
  expect(deletionSelection([old], new Set([CHAT_A]), included, ID_A).state).toBe('archived');
});

it.each(locales)('renders every supplementary category collapsed by default in %s', (locale) => {
  const view = catalog();
  for (const group of ['archived', 'scheduled', 'oldOrganization', 'deleted', 'unverified'] as const) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale, children: createElement(CollapsedSessionGroup, {
      group, sessions: sessionsInGroup(view.sessions, group, ID_A, included), accounts: view.accounts,
      selected: new Set<string>(), filterId: ID_A, included, onToggle: noop, onCollapse: noop, busy: false, markerCount: 1,
    }) }));
    const details = html.match(/<details class="supplementary-group"[^>]*>/u)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/\sopen(?:=|\s|>)/u);
    expect(html).not.toContain('undefined');
  }
});

it('shows Unverified as the main value rather than an authoritative zero', () => {
  const view = catalog();
  const account = { ...view.accounts[0]!, visible: null, organizationVerified: false, active: 0 };
  const html = renderToStaticMarkup(createElement(I18nProvider, { locale: 'zh-CN', children: createElement(AccountSidebar, {
    accounts: [account], included, currentFilter: ID_A, onInclude: noop, onFilter: noop, busy: false,
  }) }));
  expect(html).toContain('未核实');
  expect(html).not.toContain('0 条普通聊天');
});
