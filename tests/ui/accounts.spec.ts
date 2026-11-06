import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

type Locale = 'en' | 'zh-CN';
type Theme = 'light' | 'dark';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const EMAIL_A = 'alex@fixture.invalid';
const EMAIL_B = 'research@fixture.invalid';
const TITLES = ['Draft the account plan', 'Prepare the product release', 'Review the migration checklist', 'Write the support handoff'];
const REPORT = process.env.UI_ACCOUNTS_REPORT ?? join(process.cwd(), '.reports/2026-11-06-accounts');
const NOW = '2026-11-06T12:00:00.000Z';
test.use({ viewport: { width: 1240, height: 860 }, screenshot: 'off' });

function account(id: string, email: string | undefined, visible: number | null, current = false) {
  return { id, email, scopes: [id + '/fixture-org'], active: visible ?? 0, archived: id === B ? 1 : 0,
    total: id === A ? 6 : id === B ? 3 : 0, eligible: visible ?? 0, copies: id === A ? 6 : id === B ? 3 : 0,
    current, visible, organizationVerified: visible !== null, scheduled: id === A ? 1 : 0,
    oldCopies: id === A ? 1 : 0, deletedMarkers: id === A ? 1 : 0, unverified: 0 };
}

function session(id: string, title: string, locations: Array<[string, string]>) {
  const manageable = locations.some(([, group]) => ['visible', 'archived', 'oldOrganization'].includes(group));
  return { id, title, project: 'Fixture workspace', updatedAt: NOW, starred: false, manageable, deletable: true,
    presence: locations.map(([accountId, group]) => {
      const eligible = ['visible', 'archived'].includes(group);
      return { accountId, active: group === 'visible', archived: group === 'archived', eligible, copies: 1,
        titles: [title], reasons: [], records: [{ scope: accountId + '/fixture-org', group, title,
          project: 'Fixture workspace', updatedAt: NOW, archived: group === 'archived', eligible,
          manageable, deletable: true, starred: false, reasons: [] }] };
    }) };
}

function workspace(unknown = false) {
  return { checkedAt: NOW, revision: 'accounts-fixture-v1', blockers: [], skippedPaths: [],
    identityState: unknown ? 'unavailable' : 'verified',
    accounts: [account(A, EMAIL_A, 3, true), account(B, EMAIL_B, 2), account(C, undefined, unknown ? null : 0)],
    sessions: [
      session('plan', TITLES[0]!, [[A, 'visible']]),
      session('release', TITLES[1]!, [[A, 'visible'], [B, 'visible']]),
      session('migration', TITLES[2]!, [[A, 'visible'], [B, 'archived']]),
      session('handoff', TITLES[3]!, [[B, 'visible']]),
      session('scheduled', 'Scheduled weekly review', [[A, 'scheduled']]),
      session('old', 'Previous organization notes', [[A, 'oldOrganization']]),
      session('deleted', 'Deleted session record', [[A, 'deleted']]),
    ] };
}

async function boot(page: Page, locale: Locale = 'en', theme: Theme = 'light', unknown = false) {
  await page.addInitScript(({ data, locale, theme }) => {
    localStorage.clear();
    localStorage.setItem('claudesync.locale', locale);
    localStorage.setItem('claudesync.theme', theme);
    localStorage.setItem('claudesync.reduced-motion', 'true');
    (window as any).__accountRequests = [];
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    Object.defineProperty(window, 'claudeSync', { configurable: true, value: {
      getInfo: async () => ({ version: 'fixture', configured: true, suggestedSessionRoot: 'fixture-sessions', suggestedProjectsRoot: 'fixture-projects' }),
      check: async () => clone(data),
      preview: async (request: any) => {
        (window as any).__accountRequests.push(clone(request));
        const selected = data.sessions.filter(item => request.sessionIds.includes(item.id));
        const changes = selected.flatMap(item => request.accountIds.map((accountId: string) =>
          ({ sessionId: item.id, title: item.title, accountId, action: request.kind, copies: 1 })));
        return { token: 'fixture-only-preview', kind: request.kind, group: request.group, accountIds: request.accountIds,
          selected: selected.map(({ id, title }) => ({ id, title })), changes, conflicts: [], skipped: [], fileCount: changes.length };
      },
      apply: async () => { throw new Error('Acceptance fixtures never apply operations'); },
      backups: async () => [],
    } });
  }, { data: workspace(unknown), locale, theme });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'home');
  await expect(page.locator('.account-card')).toHaveCount(3);
}

function card(page: Page, id: string) { return page.locator('.account-card[data-account-id="' + id + '"]'); }
function viewing(page: Page) { return page.getByRole('combobox', { name: /^(Viewing|正在查看)$/ }); }
function group(page: Page) { return page.getByRole('combobox', { name: /^(Group|分组)$/ }); }
function included(page: Page, email: string) { return page.locator('.action-account-strip').getByRole('checkbox', { name: new RegExp(email.replaceAll('.', '\\.')) }); }
async function openList(page: Page, locale: Locale = 'en') {
  await page.getByRole('button', { name: locale === 'en' ? 'On this Mac' : '本机会话', exact: true }).click();
  await expect(viewing(page)).toBeVisible();
}
async function capture(page: Page, name: string) {
  mkdirSync(REPORT, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: join(REPORT, name + '.png'), animations: 'disabled', fullPage: false });
}

for (const locale of ['en', 'zh-CN'] as const) for (const theme of ['light', 'dark'] as const) {
  test('account-first — ' + locale + ' / ' + theme, async ({ page }) => {
    await boot(page, locale, theme);
    await expect(card(page, A).locator('h2')).toHaveText(EMAIL_A);
    await expect(card(page, B).locator('h2')).toHaveText(EMAIL_B);
    await expect(card(page, C).locator('h2')).toContainText('33333333');
    await expect(page.locator('.account-card[data-current="true"]')).toHaveCount(1);
    await expect(card(page, A).locator('.account-count strong')).toHaveText('3');
    await expect(card(page, B).locator('.account-count strong')).toHaveText('2');
    await expect(card(page, C).locator('.account-count strong')).toHaveText('0');
    await expect(card(page, A).locator('.account-other-counts dd')).toHaveText(['0', '1', '1']);
    await expect(card(page, A).locator('.account-difference strong')).toHaveText(locale === 'en' ? '1 session to add' : '可补充 1 条会话');
    await expect(card(page, B).locator('.account-difference strong')).toHaveText(locale === 'en' ? '1 session to add' : '可补充 1 条会话');
    await expect(card(page, A)).toContainText(locale === 'en' ? 'Signed in on Desktop' : 'Desktop 当前登录');
    await expect(card(page, B)).toContainText(locale === 'en' ? 'Not signed in on Desktop' : '未在 Desktop 登录');
    for (const id of [A, B, C]) await expect(card(page, id).locator('.account-session-link')).toBeInViewport({ ratio: 1 });
    await capture(page, 'accounts-' + locale + '-' + theme);
    await card(page, A).locator('.account-session-link').click();
    await expect(viewing(page)).toHaveValue(A);
    await expect(page.locator('.session-row')).toHaveCount(3);
    await expect(page.locator('.session-row').filter({ hasText: TITLES[1] }).locator('.session-account-chip')).toHaveText([EMAIL_A, EMAIL_B]);
    await viewing(page).selectOption('all');
    await expect(page.locator('.session-row')).toHaveCount(4);
    await expect(page.locator('.action-account-strip input:checked')).toHaveCount(3);
    await expect(page.locator('.review-scope, .summary-card, details[data-group]')).toHaveCount(0);
    if (locale === 'en') {
      const text = await page.locator('.claudesync-app').evaluate(root => {
        const copy = root.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('select').forEach(item => item.remove());
        return copy.textContent;
      });
      expect(text).not.toMatch(/[\u3400-\u9fff]/u);
    }
    if (locale === 'en' && theme === 'light' || locale === 'zh-CN' && theme === 'dark')
      await capture(page, 'sessions-' + locale + '-' + theme);
  });
}

for (const action of ['sync', 'archive'] as const) {
  test('account-first — viewing preserves the checked ' + action + ' scope', async ({ page }) => {
    await boot(page);
    await openList(page);
    await included(page, '33333333').uncheck();
    await included(page, EMAIL_B).uncheck();
    await expect(page.locator('.session-row')).toHaveCount(4);
    await expect(page.getByRole('checkbox', { name: TITLES[3], exact: true })).toBeDisabled();
    await viewing(page).selectOption(B);
    await expect(included(page, EMAIL_A)).toBeChecked();
    await expect(included(page, EMAIL_B)).not.toBeChecked();
    await expect(page.locator('.session-row')).toHaveCount(2);
    await included(page, EMAIL_B).check();
    await viewing(page).selectOption(A);
    await expect(included(page, EMAIL_A)).toBeChecked();
    await expect(included(page, EMAIL_B)).toBeChecked();
    await page.getByRole('checkbox', { name: TITLES[1], exact: true }).check();
    if (action === 'archive') {
      await page.locator('.more-actions > summary').click();
      await page.getByRole('button', { name: 'Archive selected', exact: true }).click();
    } else await page.getByRole('button', { name: 'Review sync', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__accountRequests)).toEqual([
      expect.objectContaining({ kind: action, accountIds: [A, B], sessionIds: ['release'], group: 'visible' }),
    ]);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}

test('account-first — filters disclose hidden selections and groups clear them', async ({ page }) => {
  await boot(page);
  await openList(page);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await page.locator('.list-toolbar input[type="search"]').fill('support handoff');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.selection-summary')).toContainText('1 selected Code sessions are hidden by filters and still included.');
  await viewing(page).selectOption(B);
  await expect(page.locator('.selection-summary strong')).toContainText('0');
  await page.locator('.list-toolbar input[type="search"]').clear();
  await viewing(page).selectOption(A);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await group(page).selectOption('scheduled');
  await expect(page.locator('.selection-summary strong')).toContainText('0');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.session-row')).toContainText('Scheduled weekly review');
  await group(page).selectOption('oldOrganization');
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect(page.locator('.session-row')).toContainText('Previous organization notes');
  await group(page).selectOption('visible');
  await expect(page.locator('.session-row')).toHaveCount(3);
  await included(page, '33333333').uncheck();
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(card(page, A).locator('.account-count strong')).toHaveText('3');
  await page.locator('.account-missing-summary .missing-filter').click();
  await expect(viewing(page)).toHaveValue('all');
  await expect(page.locator('.list-toolbar .missing-filter')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.session-row')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: TITLES[2], exact: true })).toHaveCount(0);
});

test('account-first — unavailable identity never asserts a current account or a zero count', async ({ page }) => {
  await boot(page, 'en', 'light', true);
  await expect(page.locator('.account-card[data-current="true"]')).toHaveCount(0);
  for (const id of [A, B, C]) await expect(card(page, id)).toContainText('Desktop sign-in not verified');
  await expect(card(page, C).locator('.account-count strong')).toHaveText('—');
  await expect(card(page, C).locator('.account-count')).toContainText('Count unavailable');
  await expect(page.locator('.account-missing-summary .missing-filter')).toBeDisabled();
});

test('account-first — failed refresh neutralizes a previously verified Desktop badge', async ({ page }) => {
  await boot(page);
  await expect(card(page, A).locator('.account-status')).toHaveAttribute('data-status', 'current');
  await page.evaluate(() => {
    (window as any).claudeSync.check = async () => { throw new Error('fixture-check-failure'); };
  });
  await page.getByRole('button', { name: 'Check accounts', exact: true }).click();
  await expect(page.locator('.account-card[data-current="true"]')).toHaveCount(0);
  await expect(page.locator('.account-status[data-status="accountUnchecked"]')).toHaveCount(3);
  for (const id of [A, B, C]) await expect(card(page, id)).toContainText('Desktop sign-in not verified');
});

test('account-first — unrelated preview errors preserve the verified Desktop badge', async ({ page }) => {
  await boot(page);
  await openList(page);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await page.evaluate(() => {
    (window as any).claudeSync.preview = async () => { throw new Error('fixture-preview-failure'); };
  });
  await page.getByRole('button', { name: 'Review sync', exact: true }).click();
  await expect(page.locator('.shell-feedback > *')).toHaveCount(1);
  await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await expect(card(page, A).locator('.account-status')).toHaveAttribute('data-status', 'current');
  await expect(page.locator('.account-card[data-current="true"]')).toHaveCount(1);
});
