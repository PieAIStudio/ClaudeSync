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
const REPORT = process.env.UI_ACCOUNTS_REPORT ?? join(process.cwd(), '.reports/2026-11-06-accounts-r2');
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

type FixtureState = 'populated' | 'checking' | 'empty' | 'aligned';

function alignedWorkspace() {
  const data = workspace();
  data.sessions = data.sessions.filter(item => item.presence.some(copy => copy.active))
    .map(item => session(item.id, item.title, [[A, 'visible'], [B, 'visible'], [C, 'visible']]));
  data.accounts = data.accounts.map(item => ({ ...item, active: 4, visible: 4, eligible: 4,
    total: 4, copies: 4, archived: 0, scheduled: 0, oldCopies: 0, deletedMarkers: 0 }));
  return data;
}

async function boot(page: Page, locale: Locale = 'en', theme: Theme = 'light', unknown = false, initial: FixtureState = 'populated') {
  const data = initial === 'aligned' ? alignedWorkspace() : workspace(unknown);
  if (initial === 'empty') { data.accounts = []; data.sessions = []; }
  await page.addInitScript(({ data, locale, theme, holdCheck }) => {
    localStorage.clear();
    localStorage.setItem('claudesync.locale', locale);
    localStorage.setItem('claudesync.theme', theme);
    localStorage.setItem('claudesync.reduced-motion', 'true');
    (window as any).__accountRequests = [];
    (window as any).__accountEvidence = {};
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
    Object.defineProperty(window, 'claudeSync', { configurable: true, value: {
      getInfo: async () => ({ version: 'fixture', configured: true, suggestedSessionRoot: 'fixture-sessions', suggestedProjectsRoot: 'fixture-projects' }),
      check: async () => {
        if (holdCheck) return new Promise(resolve => {
          (window as any).__accountEvidence.releaseCheck = () => resolve(clone(data));
        });
        return clone(data);
      },
      preview: async (request: any) => {
        (window as any).__accountRequests.push(clone(request));
        const selected = data.sessions.filter(item => request.sessionIds.includes(item.id));
        const changes = selected.flatMap(item => request.accountIds.map((accountId: string) => ({
          sessionId: item.id, title: item.title, accountId, copies: 1,
          action: request.kind === 'sync' ? item.presence.some(copy => copy.accountId === accountId) ? 'update' : 'add' : request.kind,
        })));
        return { token: 'fixture-only-preview', kind: request.kind, group: request.group, accountIds: request.accountIds,
          selected: selected.map(({ id, title }) => ({ id, title })), changes, conflicts: [], skipped: [], fileCount: changes.length };
      },
      apply: async () => { throw new Error('Acceptance fixtures never apply operations'); },
      backups: async () => [],
    } });
  }, { data, locale, theme, holdCheck: initial === 'checking' });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'home');
  if (initial === 'checking') await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'checking');
  else await expect(page.locator('.account-card')).toHaveCount(data.accounts.length);
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
  const bar = await page.locator('.game-ui-shell-window-bar').boundingBox();
  expect(bar, 'Neutral window bar must have a layout box').not.toBeNull();
  if (bar) await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.session-row:hover, .account-card:hover')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: join(REPORT, name + '.png'), animations: 'disabled', fullPage: false });
}

function afterSyncWorkspace() {
  const data = workspace();
  const selected = data.sessions.find(item => item.id === 'plan')!;
  for (const id of [B, C]) {
    selected.presence.push(session('plan', TITLES[0]!, [[id, 'visible']]).presence[0]!);
    const target = data.accounts.find(item => item.id === id)!;
    target.visible = (target.visible ?? 0) + 1;
    target.active += 1; target.eligible += 1; target.total += 1; target.copies += 1;
  }
  data.revision = 'accounts-fixture-v2';
  return data;
}

async function installApplyGate(page: Page) {
  await page.evaluate(response => {
    const controls = (window as any).__accountEvidence;
    controls.applyStarted = false;
    (window as any).claudeSync.apply = async (token: string) => {
      if (token !== 'fixture-only-preview') throw new Error('Unexpected fixture token');
      controls.applyStarted = true;
      return new Promise((resolve, reject) => {
        controls.finishApply = () => resolve(response);
        controls.failApply = () => reject(new Error('claudesync-message:errorWorkspaceChanged:{}'));
      });
    };
  }, { result: { filesChanged: 3, verified: true, backup: 'fixture-backup' }, workspace: afterSyncWorkspace() });
}

async function openSyncReview(page: Page, locale: Locale) {
  await openList(page, locale);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await page.getByRole('button', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.review-changes li')).toHaveCount(3);
  await expect(dialog.locator('.review-accounts > span')).toHaveCount(3);
  for (const name of [EMAIL_A, EMAIL_B, '33333333']) await expect(dialog.locator('.review-accounts')).toContainText(name);
  return dialog;
}

async function assertReceipt(page: Page, locale: Locale, verified: boolean) {
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt).toHaveAttribute('data-verified', String(verified));
  const row = receipt.locator('.completion-list li').first();
  const title = row.locator(':scope > strong');
  await expect(title).toHaveText(TITLES[0]!);
  for (const name of [EMAIL_A, EMAIL_B, '33333333']) {
    await expect(row.locator(':scope > span:last-child')).toContainText(name);
    if (verified) await expect(receipt.locator('.complete-card header p')).toContainText(name);
  }
  const layout = await title.evaluate(item => {
    const box = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    return { width: box.width, height: box.height, overflow: item.scrollWidth - item.clientWidth,
      lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 };
  });
  expect(layout.width, 'Receipt title must have readable width').toBeGreaterThanOrEqual(160);
  expect(layout.height).toBeGreaterThan(0);
  expect(layout.height, 'This session title should use at most two lines').toBeLessThanOrEqual(layout.lineHeight * 2 + 1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  const back = receipt.getByRole('button', { name: locale === 'en' ? 'Back to chats' : '回到聊天', exact: true });
  await expect(back).toBeInViewport({ ratio: 1 });
  await expect.poll(() => back.evaluate(item => {
    const box = item.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(hit && (hit === item || item.contains(hit)));
  }), { message: 'Back to chats must not be covered by feedback' }).toBe(true);
  return back;
}

for (const locale of ['en', 'zh-CN'] as const) for (const theme of ['light', 'dark'] as const) {
  test('account-first — ' + locale + ' / ' + theme, async ({ page }) => {
    await boot(page, locale, theme);
    const accountScreen = page.locator('.stage-surface--accounts');
    await expect(accountScreen).toHaveAttribute('data-account-state', 'missing');
    await expect(accountScreen.locator('h1')).toHaveText(locale === 'en' ? '4 sessions are missing from some accounts' : '4 条会话在部分账号中缺失');
    await expect(page.locator('.account-heading-actions .missing-filter')).toBeEnabled();
    await expect(card(page, C).locator('.account-avatar')).not.toHaveText('3');
    await expect(page.locator('.account-count-rule')).toHaveCount(1);
    await expect(card(page, A).locator('.sign-in-dot')).toBeVisible();
    if (theme === 'dark') {
      const dark = await card(page, A).evaluate(item => getComputedStyle(item).background);
      await page.getByRole('button', { name: 'Light mode', exact: true }).click();
      await expect(page.locator('.claudesync-app')).toHaveAttribute('data-game-ui-theme', 'light');
      await expect.poll(() => card(page, A).evaluate(item => getComputedStyle(item).background), { message: 'Accounts cards must have a distinct dark appearance' }).not.toBe(dark);
      await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
      await expect(page.locator('.claudesync-app')).toHaveAttribute('data-game-ui-theme', 'dark');
    }
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
  await expect(page.locator('.selection-summary strong')).toHaveText('1 selected · from 1 account');
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
  await page.locator('.account-heading-actions .missing-filter').click();
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
  await expect(page.getByRole('button', { name: 'Check accounts', exact: true })).toBeEnabled();
  await expect(page.locator('.account-heading-actions .missing-filter')).toHaveCount(0);
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

const EVIDENCE_VARIANTS: Array<{ locale: Locale; theme: Theme }> = [
  { locale: 'en', theme: 'light' }, { locale: 'zh-CN', theme: 'dark' },
];
for (const { locale, theme } of EVIDENCE_VARIANTS) {
  const suffix = locale + '-' + theme;
  test('account-first evidence — checking / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'checking');
    await expect(page.locator('.account-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Check accounts' : '检查账号', exact: true })).toBeDisabled();
    await capture(page, 'accounts-checking-' + suffix);
    await page.evaluate(() => (window as any).__accountEvidence.releaseCheck());
    await expect(page.locator('.account-card')).toHaveCount(3);
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'missing');
  });

  test('account-first evidence — Desktop verification failed / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, true);
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'unverified');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'Desktop sign-in needs checking.' : '请核实 Desktop 登录状态。');
    await expect(page.locator('.account-status[data-status="current"]')).toHaveCount(0);
    await expect(page.locator('.account-status[data-status="accountUnchecked"]')).toHaveCount(3);
    await expect(card(page, C).locator('.account-count strong')).toHaveText('—');
    await expect(page.locator('.account-heading-actions .missing-filter')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Check accounts' : '检查账号', exact: true })).toBeEnabled();
    await capture(page, 'accounts-failed-check-' + suffix);
  });

  test('account-first evidence — empty Accounts / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'empty');
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'empty');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'No local accounts found.' : '未找到本地账号。');
    await expect(page.locator('.account-card')).toHaveCount(0);
    await capture(page, 'accounts-empty-' + suffix);
  });

  test('account-first evidence — all accounts aligned / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'aligned');
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'aligned');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'All sessions available to sync are present.' : '可同步会话的副本已齐全。');
    await expect(page.locator('.account-count strong')).toHaveText(['4', '4', '4']);
    await expect(page.locator('.account-difference strong')).toHaveText(Array(3).fill(locale === 'en' ? 'No missing copies' : '副本无缺失'));
    await expect(page.locator('.account-heading-actions .missing-filter')).toHaveCount(0);
    await expect(page.locator('.account-heading-actions').getByRole('button', { name: locale === 'en' ? 'View sessions' : '查看会话', exact: true })).toBeEnabled();
    await capture(page, 'accounts-aligned-' + suffix);
  });

  test('account-first evidence — selected rows and source accounts / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await openList(page, locale);
    for (const title of [TITLES[0], TITLES[3]]) await page.getByRole('checkbox', { name: title, exact: true }).check();
    await expect(page.locator('.session-row.is-selected')).toHaveCount(2);
    await expect(page.locator('.action-account-strip input:checked')).toHaveCount(3);
    const summary = page.locator('.selection-summary strong');
    await expect(summary).toHaveText(locale === 'en' ? '2 selected · from 2 accounts' : '已选 2 条 · 来自 2 个账号');
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true })).toBeEnabled();
    await capture(page, 'sessions-selected-' + suffix);
  });

  test('account-first evidence — no search results / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await openList(page, locale);
    await page.locator('.list-toolbar input[type="search"]').fill('no matching session');
    await expect(page.locator('.session-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true })).toBeDisabled();
    await capture(page, 'sessions-no-results-' + suffix);
  });

  test('account-first evidence — empty account group / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await openList(page, locale);
    await viewing(page).selectOption(A);
    await group(page).selectOption('archived');
    await expect(page.locator('.session-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Unarchive selected' : '取消归档', exact: true })).toBeDisabled();
    await capture(page, 'sessions-empty-group-' + suffix);
  });

  test('account-first evidence — review, progress and verified completion / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await installApplyGate(page);
    const dialog = await openSyncReview(page, locale);
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyStarted)).toBe(false);
    await capture(page, 'sessions-review-sync-' + suffix);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Confirm changes' : '确认执行', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyStarted)).toBe(true);
    await capture(page, 'sessions-progress-' + suffix);
    await page.evaluate(() => (window as any).__accountEvidence.finishApply());
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.locator('.complete-proof')).toHaveText(locale === 'en' ? 'Verified' : '已核对');
    const back = await assertReceipt(page, locale, true);
    await capture(page, 'sessions-done-' + suffix);
    await back.click();
    await expect(page.locator('.session-row').filter({ hasText: TITLES[0] }).locator('.session-account-chip')).toHaveCount(3);
  });

  test('account-first evidence — operation failure / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await installApplyGate(page);
    const dialog = await openSyncReview(page, locale);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Confirm changes' : '确认执行', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    await page.evaluate(() => (window as any).__accountEvidence.failApply());
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.locator('.complete-proof')).toHaveText(locale === 'en' ? 'Changes could not be verified' : '未能核实改动');
    await expect(page.locator('.complete-card h1')).toHaveText(locale === 'en' ? 'An issue to resolve' : '需要处理的问题');
    await expect(page.locator('.complete-card')).toContainText(locale === 'en' ? 'Changes stopped' : '已停止修改');
    await assertReceipt(page, locale, false);
    await capture(page, 'sessions-error-' + suffix);
  });
}

test('account-first — keyboard scope and review cancellation', async ({ page }) => {
  await boot(page);
  await openList(page);
  await installApplyGate(page);
  // Native typeahead keeps this keyboard path deterministic in headless macOS.
  await viewing(page).focus();
  await expect(viewing(page)).toBeFocused();
  await page.keyboard.type('alex');
  await expect(viewing(page)).toHaveValue(A);
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Tab');
  await expect(group(page)).toBeFocused();
  await page.keyboard.type('archived');
  await expect(group(page)).toHaveValue('archived');
  // Blur and return before starting another native typeahead session.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(group(page)).toBeFocused();
  await page.keyboard.type('current');
  await expect(group(page)).toHaveValue('visible');
  const choice = page.getByRole('checkbox', { name: TITLES[0], exact: true });
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  await page.getByRole('button', { name: 'Review sync', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeFocused();
  const confirm = dialog.getByRole('button', { name: 'Confirm changes', exact: true });
  for (let index = 0; index < 12 && !(await confirm.evaluate(item => item === document.activeElement)); index += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'results');
  await expect(choice).toBeChecked();
  expect(await page.evaluate(() => (window as any).__accountEvidence.applyStarted)).toBe(false);
});

test('account-first — desktop controls and review fit at 1024 by 768', async ({ page }) => {
  await boot(page);
  await openList(page);
  await page.evaluate(() => document.fonts.ready);
  const firstRow = page.locator('.session-row').first();
  const footer = page.locator('.review-footer-actions');
  const review = page.getByRole('button', { name: 'Review sync', exact: true });
  for (const size of [{ width: 1240, height: 860 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expect(page.locator('.game-ui-shell-sidebar')).toBeVisible();
    for (const control of [viewing(page), group(page), page.locator('.action-account-strip'), firstRow, footer, review]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    const metrics = await group(page).evaluate(element => {
      const select = element as HTMLSelectElement;
      const box = select.getBoundingClientRect();
      const parent = select.closest('.session-group-control')!.getBoundingClientRect();
      const search = document.querySelector('.list-toolbar > input[type="search"]')!.getBoundingClientRect();
      const style = getComputedStyle(select);
      const canvas = document.createElement('canvas').getContext('2d')!;
      canvas.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
      const text = select.selectedOptions[0]!.textContent!.trim();
      return { inside: box.right <= parent.right + 0.5, gap: search.left - box.right,
        sameRow: Math.abs(search.top - box.top) < 1,
        chevronHit: document.elementFromPoint(box.right - 8, box.top + box.height / 2) === select,
        available: select.clientWidth - parseFloat(style.paddingInlineStart) - Math.max(24, parseFloat(style.paddingInlineEnd)),
        textWidth: canvas.measureText(text).width + (parseFloat(style.letterSpacing) || 0) * Math.max(0, text.length - 1) };
    });
    expect(metrics.inside).toBe(true);
    expect(metrics.gap).toBeGreaterThanOrEqual(4);
    expect(metrics.sameRow).toBe(true);
    expect(metrics.chevronHit).toBe(true);
    expect(metrics.available).toBeGreaterThanOrEqual(Math.ceil(metrics.textWidth));
    const rowBox = await firstRow.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(rowBox).not.toBeNull(); expect(footerBox).not.toBeNull();
    expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
    if (size.width === 1240) expect(rowBox!.y).toBeLessThanOrEqual(315);
  }
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await review.click();
  const dialog = page.getByRole('dialog');
  for (const control of [dialog, dialog.locator('.dialog-head'), dialog.locator('.dialog-actions'),
    dialog.getByRole('button', { name: 'Confirm changes', exact: true })]) {
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  const body = await dialog.locator('.dialog-body').boundingBox();
  const actions = await dialog.locator('.dialog-actions').boundingBox();
  expect(body).not.toBeNull(); expect(actions).not.toBeNull();
  expect(body!.y + body!.height).toBeLessThanOrEqual(actions!.y + 1);
});
