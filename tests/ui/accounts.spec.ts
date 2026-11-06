import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const REPORT = process.env.UI_ACCOUNTS_REPORT ?? join(process.cwd(), '.reports/2026-11-06-accounts-r4');
const NOW = '2026-11-06T12:00:00.000Z';
const DPR = Number(process.env.UI_ACCOUNTS_DPR ?? '1');
if (DPR !== 1 && DPR !== 2) throw new Error('UI_ACCOUNTS_DPR must be 1 or 2');
test.use({ viewport: { width: 1240, height: 860 }, deviceScaleFactor: DPR, screenshot: 'off' });

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
async function assertReviewChips(page: Page) {
  const chips = page.locator('.review-changes .review-change-chip');
  for (const chip of await chips.all()) {
    await expect(chip).toBeVisible();
    await expect(chip.locator(':scope > .game-ui-droplet')).toBeHidden();
    const paint = await chip.evaluate(item => {
      const css = getComputedStyle(item);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = css.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { radius: parseFloat(css.borderTopLeftRadius), height: item.getBoundingClientRect().height,
        alpha: context.getImageData(0, 0, 1, 1).data[3], shadow: css.boxShadow, opacity: css.opacity };
    });
    expect(paint.radius, 'Review actions have a regular pill edge').toBeGreaterThanOrEqual(paint.height / 2);
    expect(paint.alpha, 'Review pills use opaque paint on every row').toBe(255);
    expect(paint.shadow).toBe('none');
    expect(paint.opacity).toBe('1');
  }
}

async function assertResultPlacement(page: Page) {
  const card = page.locator('.complete-card');
  if (!(await card.count())) return;
  const primary = card.locator('.receipt-primary');
  await expect(primary).toBeInViewport({ ratio: 1 });
  const edges = await card.evaluate(item => {
    const box = item.getBoundingClientRect();
    const css = getComputedStyle(item);
    return { left: box.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft),
      right: box.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight) };
  });
  const box = (await primary.boundingBox())!;
  expect(Math.abs(box.x + box.width - edges.right), 'Result primary aligns with the content right edge').toBeLessThanOrEqual(2);
  const quiet = card.locator('.receipt-back');
  if (await quiet.count()) {
    await expect(quiet).toBeInViewport({ ratio: 1 });
    const back = (await quiet.boundingBox())!;
    expect(Math.abs(back.x - edges.left), 'Quiet return action aligns with the content left edge').toBeLessThanOrEqual(2);
    expect(await quiet.evaluate(item => parseFloat(getComputedStyle(item).paddingLeft))).toBe(0);
  }
}

async function capture(page: Page, name: string, narrow = false) {
  const only = process.env.UI_ACCOUNTS_CAPTURE;
  if (only && !new RegExp(only).test(name)) return;
  mkdirSync(REPORT, { recursive: true });
  const locale = name.includes('zh-CN') ? 'zh-CN' : 'en';
  await expect(page.locator('.shell-window-title')).toHaveText(name.startsWith('accounts')
    ? locale === 'en' ? 'Accounts' : '账号'
    : locale === 'en' ? 'On this Mac' : '本机会话');
  const original = page.viewportSize()!;
  const sizes = [original, ...(narrow ? [{ width: 1024, height: 768 }] : [])];
  for (const [index, size] of sizes.entries()) {
    if (index > 0) await page.setViewportSize(size);
    const bar = await page.locator('.game-ui-shell-window-bar').boundingBox();
    expect(bar, 'Neutral window bar must have a layout box').not.toBeNull();
    if (bar) await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('button:hover, input:hover, select:hover, summary:hover, .session-row:hover, .account-card:hover')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await assertResultPlacement(page);
    await assertReviewChips(page);
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    const actualDpr = await page.evaluate(() => window.devicePixelRatio);
    expect(actualDpr, 'Evidence uses a genuine device-scale browser context').toBe(DPR);
    const path = join(REPORT, name + (index ? '-1024x768' : '') + '-' + DPR + 'x.png');
    const png = await page.screenshot({ path, animations: 'disabled', fullPage: false, scale: 'device' });
    // PNG IHDR dimensions prove that the capture retains device pixels, without upscaling.
    const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    expect(pixels.width).toBe(size.width * DPR);
    expect(pixels.height).toBe(size.height * DPR);
    writeFileSync(path.replace(/\.png$/, '.json'), JSON.stringify({ schemaVersion: 1,
      state: name, capturedAt: new Date().toISOString(), viewport: size, devicePixelRatio: actualDpr,
      png: pixels, scale: 'device', sha256: createHash('sha256').update(png).digest('hex'),
      browser: page.context().browser()?.version(), hoveredContent: false,
    }, null, 2) + '\n');
  }
  if (narrow) await page.setViewportSize(original);
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

async function leaveParticipantUnchanged(page: Page, accountId: string) {
  await page.evaluate(unchangedId => {
    const api = (window as any).claudeSync;
    const preview = api.preview;
    api.preview = async (request: any) => {
      const plan = await preview(request);
      plan.changes = plan.changes.filter((change: any) => change.accountId !== unchangedId);
      plan.fileCount = plan.changes.length;
      return plan;
    };
  }, accountId);
}

async function installApplyGate(page: Page, completedWorkspace = afterSyncWorkspace()) {
  await page.evaluate(({ response, accountA, accountB }) => {
    const controls = (window as any).__accountEvidence;
    controls.applyStarted = false;
    controls.applyCalls = 0;
    (window as any).claudeSync.apply = async (token: string) => {
      if (token !== 'fixture-only-preview') throw new Error('Unexpected fixture token');
      controls.applyStarted = true;
      controls.applyCalls += 1;
      return new Promise((resolve, reject) => {
        controls.finishApply = () => resolve(response);
        controls.failApply = () => reject(new Error('claudesync-message:errorWorkspaceChanged:{}'));
        controls.partialApply = () => reject(new Error('claudesync-message:errorBackupInterrupted:' + JSON.stringify({
          message: 'Fixture operation interrupted', path: 'fixture-backup', applied: 1,
          changedAccountIds: [accountA], pendingAccountIds: [accountA, accountB],
        })));
      });
    };
  }, { response: { result: { filesChanged: 3, verified: true, backup: 'fixture-backup' }, workspace: completedWorkspace }, accountA: A, accountB: B });
}

async function openSyncReview(page: Page, locale: Locale, changeCount = 3) {
  await openList(page, locale);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await page.getByRole('button', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true })).toBeVisible();
  await expect(dialog.locator('.review-changes li')).toHaveCount(changeCount);
  await expect(dialog.locator('.review-change-chip')).toHaveText([
    locale === 'en' ? 'Update to latest' : '更新为最新版本',
    ...Array(changeCount - 1).fill(locale === 'en' ? 'Add to this account' : '添加到此账号'),
  ]);
  await expect(dialog.locator('.review-more > summary')).toHaveText(locale === 'en' ? '1 session selected' : '已选 1 条会话');
  await expect(dialog.locator('.review-accounts > span')).toHaveCount(3);
  for (const name of [EMAIL_A, EMAIL_B, '33333333']) await expect(dialog.locator('.review-accounts')).toContainText(name);
  return dialog;
}

async function assertReceipt(page: Page, locale: Locale, verified: boolean) {
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt).toHaveAttribute('data-verified', String(verified));
  if (verified) {
    await expect(receipt.locator('.complete-card h1')).toHaveText(locale === 'en' ? 'Synced 1 session' : '已同步 1 条会话');
    const row = receipt.locator('.completion-list li').first();
    const title = row.locator(':scope > strong');
    await expect(title).toHaveText(TITLES[0]!);
    const targets = row.locator(':scope > span:last-child');
    for (const name of [EMAIL_A, EMAIL_B, '33333333']) await expect(targets).toContainText(name);
    await expect(targets).toContainText(locale === 'en' ? 'Added to' : '已补充到');
    await expect(targets).toContainText(locale === 'en' ? 'Updated in' : '已更新');
    await expect(receipt.locator('.complete-card header p')).toHaveCount(0);
    await expect(receipt.locator('.complete-proof')).toHaveText(locale === 'en' ? 'Verified' : '已核对');
    await expect(receipt.locator('.receipt-recovery')).toHaveText(locale === 'en' ? 'A backup was created.' : '已创建备份。');
    expect(((await receipt.innerText()).match(locale === 'en' ? /\bVerified\b/g : /已核对/g) ?? []).length).toBe(1);
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
  }
  const back = receipt.getByRole('button', { name: locale === 'en' ? 'Back to sessions' : '返回会话列表', exact: true });
  await expect(back).toBeInViewport({ ratio: 1 });
  await expect.poll(() => back.evaluate(item => {
    const box = item.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(hit && (hit === item || item.contains(hit)));
  }), { message: 'Back to sessions must not be covered by feedback' }).toBe(true);
  if (!verified) await expect(receipt.getByRole('button', { name: locale === 'en' ? 'Refresh and review again' : '刷新后重新预览', exact: true })).toBeInViewport({ ratio: 1 });
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
    if (theme === 'dark') {
      const paint = (selector: string) => page.locator(selector).evaluate(item => {
        const css = getComputedStyle(item);
        return { color: css.color, weight: css.fontWeight };
      });
      expect(await paint('.list-refresh')).toEqual(await paint('.filter-drawer > summary'));
    }
    if (locale === 'zh-CN') {
      const missing = page.locator('.session-row').filter({ hasText: TITLES[0] }).locator('.session-missing-accounts');
      await expect(missing).toContainText('、');
      await expect(missing).not.toContainText(', ');
    }
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
  await expect(page.locator('.selection-summary')).toContainText('Hidden by filters: 1 selected, still included.');
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
  await expect(page.locator('.stage-surface--accounts h1')).toHaveText('Desktop sign-in not verified');
  await expect(page.locator('.account-status[data-status="accountUnchecked"]')).toHaveCount(0);
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
  await expect(page.locator('.account-status[data-status="accountUnchecked"]')).toHaveCount(0);
  await expect(page.locator('.stage-surface--accounts h1')).toHaveText('Desktop sign-in not verified');
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
  { locale: 'en', theme: 'light' }, { locale: 'en', theme: 'dark' },
  { locale: 'zh-CN', theme: 'light' }, { locale: 'zh-CN', theme: 'dark' },
];
for (const { locale, theme } of EVIDENCE_VARIANTS) {
  const suffix = locale + '-' + theme;
  test('account-first evidence — checking / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'checking');
    await expect(page.locator('.account-card')).toHaveCount(0);
    const check = page.getByRole('button', { name: locale === 'en' ? 'Check accounts' : '核对账号', exact: true });
    await expect(check).toBeDisabled();
    const disabledPaint = await check.evaluate(item => {
      const css = getComputedStyle(item);
      return [css.color, css.backgroundColor, css.opacity].join('|');
    });
    await expect(page.locator('.stage-surface--accounts').getByText(locale === 'en' ? 'Checking accounts…' : '正在核对账号…', { exact: true })).toHaveCount(1);
    await expect(page.locator('.account-spinner')).toBeVisible();
    await expect(page.locator('.account-placeholder')).toHaveCount(3);
    await capture(page, 'accounts-checking-' + suffix);
    await page.evaluate(() => (window as any).__accountEvidence.releaseCheck());
    await expect(check).toBeEnabled();
    const enabledPaint = await check.evaluate(item => {
      const css = getComputedStyle(item);
      return [css.color, css.backgroundColor, css.opacity].join('|');
    });
    expect(disabledPaint, 'Checking must visibly disable the action').not.toBe(enabledPaint);
    await expect(page.locator('.account-card')).toHaveCount(3);
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'missing');
  });

  test('account-first evidence — Desktop verification failed / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, true);
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'unverified');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'Desktop sign-in not verified' : 'Desktop 登录状态未核对');
    await expect(page.locator('.stage-surface--accounts .relay-art[data-relay-state="attention"] .relay-badge')).toBeVisible();
    await expect(page.locator('.account-status[data-status="current"]')).toHaveCount(0);
    await expect(page.locator('.account-status[data-status="accountUnchecked"]')).toHaveCount(0);
    await expect(card(page, C).locator('.account-count strong')).toHaveText('—');
    await expect(page.locator('.account-heading-actions .missing-filter')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Check accounts' : '核对账号', exact: true })).toBeEnabled();
    await expect(card(page, C).getByText(locale === 'en' ? 'Count unavailable' : '数量暂不可用', { exact: true })).toHaveCount(1);
    await capture(page, 'accounts-failed-check-' + suffix);
  });

  test('account-first evidence — empty Accounts / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'empty');
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'empty');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'No local accounts found' : '未找到本地账号');
    await expect(page.locator('.account-card')).toHaveCount(0);
    await capture(page, 'accounts-empty-' + suffix);
  });

  test('account-first evidence — all accounts aligned / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme, false, 'aligned');
    await expect(page.locator('.stage-surface--accounts')).toHaveAttribute('data-account-state', 'aligned');
    await expect(page.locator('.stage-surface--accounts h1')).toHaveText(locale === 'en' ? 'All syncable sessions are present' : '可同步会话的副本已齐全');
    await expect(page.locator('.stage-surface--accounts').getByText(locale === 'en' ? 'Versions will be checked before syncing' : '同步前会核对版本', { exact: true })).toHaveCount(1);
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
    await capture(page, 'sessions-selected-' + suffix, true);
  });

  test('account-first evidence — no search results / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await openList(page, locale);
    await page.locator('.list-toolbar input[type="search"]').fill('no matching session');
    await expect(page.locator('.session-row')).toHaveCount(0);
    await expect(page.locator('.select-line > label, .select-line .selection-menu')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Review sync' : '预览同步', exact: true })).toBeDisabled();
    const clear = page.getByRole('button', { name: locale === 'en' ? 'Clear search' : '清除搜索', exact: true });
    await expect(clear).toBeVisible();
    await capture(page, 'sessions-no-results-' + suffix);
    await clear.click();
    await expect(page.locator('.list-toolbar input[type="search"]')).toHaveValue('');
    await expect(page.locator('.session-row')).toHaveCount(4);
  });

  test('account-first evidence — empty account group / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await openList(page, locale);
    await viewing(page).selectOption(A);
    await group(page).selectOption('archived');
    await expect(page.locator('.session-row')).toHaveCount(0);
    await expect(page.locator('.select-line > label, .select-line .selection-menu')).toHaveCount(0);
    await expect(page.getByRole('button', { name: locale === 'en' ? 'Unarchive selected' : '取消归档', exact: true })).toBeDisabled();
    await expect(page.locator('.list-empty-state')).toHaveText(locale === 'en' ? 'No archived sessions' : '暂无已归档会话');
    await capture(page, 'sessions-empty-group-' + suffix);
  });

  test('account-first evidence — review, progress and verified completion / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await installApplyGate(page);
    const dialog = await openSyncReview(page, locale);
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyStarted)).toBe(false);
    await capture(page, 'sessions-review-sync-' + suffix, true);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Sync 1 session' : '同步 1 条会话', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyStarted)).toBe(true);
    await expect(page.locator('.progress-cancel-note')).toHaveText(locale === 'en' ? 'This can’t be stopped safely. Keep ClaudeSync open until it finishes.' : '此操作无法安全停止。请保持 ClaudeSync 打开直到完成。');
    const badgePaint = await page.locator('.stage-surface--progress .relay-badge').evaluate(item => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = getComputedStyle(item).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], opacity: getComputedStyle(item).opacity };
    });
    expect(badgePaint, 'Progress badge obscures the artwork beneath it').toEqual({ alpha: 255, opacity: '1' });
    await capture(page, 'sessions-progress-' + suffix, true);
    await page.evaluate(() => (window as any).__accountEvidence.finishApply());
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.locator('.complete-proof')).toHaveText(locale === 'en' ? 'Verified' : '已核对');
    const back = await assertReceipt(page, locale, true);
    await capture(page, 'sessions-done-' + suffix, true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await assertReceipt(page, locale, true);
    await back.click();
    await expect(page.locator('.session-row').filter({ hasText: TITLES[0] }).locator('.session-account-chip')).toHaveCount(3);
  });

  test('account-first evidence — operation failure / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await installApplyGate(page);
    const dialog = await openSyncReview(page, locale);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Sync 1 session' : '同步 1 条会话', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    await page.evaluate(() => (window as any).__accountEvidence.failApply());
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.locator('.complete-proof')).toHaveText(locale === 'en' ? 'Changes could not be verified' : '未能核对改动');
    await expect(page.locator('.complete-card h1')).toHaveText(locale === 'en' ? 'Sessions changed before syncing' : '同步前会话已变化');
    await expect(page.locator('.complete-card').getByText(locale === 'en'
      ? 'These sessions changed after your review. Changes stopped; refresh to review again.'
      : '这些会话在预览后已发生变化，已停止修改。请刷新后重新预览。', { exact: true })).toBeVisible();
    await assertReceipt(page, locale, false);
    await capture(page, 'sessions-error-' + suffix, true);
  });

  test('account-first evidence — interrupted operation distinguishes recorded, pending and unchanged accounts / ' + suffix, async ({ page }) => {
    await boot(page, locale, theme);
    await installApplyGate(page);
    await leaveParticipantUnchanged(page, C);
    const dialog = await openSyncReview(page, locale, 2);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Sync 1 session' : '同步 1 条会话', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    await page.evaluate(() => (window as any).__accountEvidence.partialApply());
    const receipt = page.locator('.stage-surface--complete');
    await expect(receipt).toHaveAttribute('data-verified', 'false');
    await expect(receipt.locator('.complete-card h1')).toHaveText(locale === 'en' ? 'Sync interrupted' : '同步已中断');
    const rows = receipt.locator('.partial-account-list li');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: EMAIL_A })).toContainText(locale === 'en' ? 'Changes recorded · not verified' : '已记录改动 · 未核对');
    await expect(rows.filter({ hasText: EMAIL_B })).toContainText(locale === 'en' ? 'Needs checking' : '需要核对');
    await expect(rows.filter({ hasText: '33333333' })).toHaveAttribute('data-outcome', 'unplanned');
    await expect(rows.filter({ hasText: '33333333' })).toContainText(locale === 'en' ? 'No changes planned' : '未计划改动');
    await expect(rows.filter({ hasText: EMAIL_A })).toHaveAttribute('data-outcome', 'recorded');
    await expect(rows.filter({ hasText: EMAIL_B })).toHaveAttribute('data-outcome', 'unconfirmed');
    await expect(rows.getByText(locale === 'en' ? 'Verified' : '已核对', { exact: true })).toHaveCount(0);
    // A appears in both native sets. A recorded write is not a completed/verified account.
    await expect(rows.filter({ hasText: EMAIL_A })).not.toContainText(locale === 'en' ? 'Needs checking' : '需要核对');
    const details = receipt.locator('.receipt-error-details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details.locator(':scope > ul')).not.toBeVisible();
    await assertReceipt(page, locale, false);
    await capture(page, 'sessions-partial-failure-' + suffix, true);
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);
  });
}

for (const locale of ['en', 'zh-CN'] as const) {
  test('account-first — recovery checks fresh state, clears conflicts and requires confirmation / ' + locale, async ({ page }) => {
    await boot(page, locale);
    await installApplyGate(page);
    await page.evaluate(({ accountA, accountB, title }) => {
      const api = (window as any).claudeSync;
      const preview = api.preview;
      api.preview = async (request: any, revision: string) => ({
        ...await preview(request, revision),
        conflicts: [{ id: 'plan', options: [
          { scope: accountA + '/fixture-org', accountId: accountA, title },
          { scope: accountB + '/fixture-org', accountId: accountB, title: 'Alternative fixture title' },
        ] }],
        progressConflicts: [{ id: 'plan', title, resolved: Boolean(request.contentSelections?.plan), options: [
          { path: 'fixture-transcript-a', accountId: accountA, title, turns: 4 },
          { path: 'fixture-transcript-b', accountId: accountB, title, turns: 3 },
        ] }],
      });
    }, { accountA: A, accountB: B, title: TITLES[0]! });
    const dialog = await openSyncReview(page, locale);
    const confirmName = locale === 'en' ? 'Sync 1 session' : '同步 1 条会话';
    await dialog.locator('.title-conflicts select:not([aria-label])').selectOption(A + '/fixture-org');
    await expect(dialog.locator('.title-conflicts select:not([aria-label])')).toHaveValue(A + '/fixture-org');
    await dialog.locator('.title-conflicts select[aria-label]').selectOption('fixture-transcript-a');
    await expect(dialog.getByRole('button', { name: confirmName, exact: true })).toBeEnabled();
    const originalRequest = await page.evaluate(() => (window as any).__accountRequests.at(-1));
    expect(originalRequest).toMatchObject({ titleSelections: { plan: A + '/fixture-org' }, contentSelections: { plan: 'fixture-transcript-a' } });
    await dialog.getByRole('button', { name: confirmName, exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
    await page.evaluate(() => (window as any).__accountEvidence.failApply());
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');

    const fresh = workspace();
    fresh.revision = 'accounts-fixture-rechecked';
    await page.evaluate(({ fresh, completed }) => {
      const api = (window as any).claudeSync;
      const controls = (window as any).__accountEvidence;
      controls.recoveryEvents = [];
      api.check = async () => {
        controls.recoveryEvents.push({ kind: 'check' });
        return new Promise(resolve => { controls.releaseRecoveryCheck = () => resolve(fresh); });
      };
      const preview = api.preview;
      api.preview = async (request: any, revision: string) => {
        controls.recoveryEvents.push({ kind: 'preview', request: JSON.parse(JSON.stringify(request)), revision });
        if (revision !== fresh.revision) throw new Error('Recovery must preview the newly checked revision');
        return { ...await preview(request, revision), token: 'fixture-recovered-preview' };
      };
      api.apply = async (token: string) => {
        controls.applyCalls += 1;
        if (token !== 'fixture-recovered-preview') throw new Error('Recovery reused a stale preview token');
        return completed;
      };
    }, { fresh, completed: { result: { filesChanged: 3, verified: true, backup: 'fixture-backup' }, workspace: afterSyncWorkspace() } });
    await page.getByRole('button', { name: locale === 'en' ? 'Refresh and review again' : '刷新后重新预览', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__accountEvidence.recoveryEvents)).toEqual([{ kind: 'check' }]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);
    await page.evaluate(() => (window as any).__accountEvidence.releaseRecoveryCheck());
    await expect(page.getByRole('dialog')).toBeVisible();
    const events = await page.evaluate(() => (window as any).__accountEvidence.recoveryEvents);
    expect(events).toEqual([
      { kind: 'check' },
      { kind: 'preview', request: { kind: 'sync', group: 'visible', sessionIds: ['plan'], accountIds: [A, B, C] }, revision: fresh.revision },
    ]);
    await expect(page.getByRole('checkbox', { name: TITLES[0], exact: true })).toBeChecked();
    await expect(page.locator('.action-account-strip input:checked')).toHaveCount(3);
    await expect(dialog.locator('.title-conflicts select:not([aria-label])')).toHaveValue('');
    await expect(dialog.locator('.title-conflicts select[aria-label]')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: confirmName, exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);

    await dialog.locator('.title-conflicts select[aria-label]').selectOption('fixture-transcript-a');
    await expect(dialog.getByRole('button', { name: confirmName, exact: true })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);
    await dialog.getByRole('button', { name: confirmName, exact: true }).click();
    await expect(page.locator('.stage-surface--complete')).toHaveAttribute('data-verified', 'true');
    expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(2);
  });
}

test('account-first — hidden selections can be cleared when no rows match', async ({ page }) => {
  await boot(page);
  await openList(page);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  const search = page.locator('.list-toolbar input[type="search"]');
  await search.fill('no matching session');
  await expect(page.locator('.session-row')).toHaveCount(0);
  await expect(page.locator('.select-line > label, .select-line .selection-menu')).toHaveCount(0);
  const clear = page.getByRole('button', { name: 'Clear selection', exact: true });
  await expect(clear).toHaveClass(/clear-hidden-selection/);
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(search).toHaveValue('no matching session');
  await expect(page.getByRole('button', { name: 'Review sync', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: TITLES[0], exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).__accountRequests)).toEqual([]);
});

test('account-first — a generic successful operation states verification once', async ({ page }) => {
  const changed = workspace();
  changed.sessions.find(item => item.id === 'plan')!.starred = true;
  await boot(page);
  await installApplyGate(page, changed);
  await openList(page);
  await page.getByRole('checkbox', { name: TITLES[0], exact: true }).check();
  await page.locator('.more-actions > summary').click();
  await page.getByRole('button', { name: 'Star selected', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm changes', exact: true }).click();
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
  await page.evaluate(() => (window as any).__accountEvidence.finishApply());
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt).toHaveAttribute('data-verified', 'true');
  await expect(receipt.locator('.complete-card h1')).toHaveText('Changes complete');
  await expect(receipt.locator('.complete-proof')).toHaveText('Verified');
  expect(((await receipt.innerText()).match(/\bVerified\b/gi) ?? []).length).toBe(1);
  expect(await page.evaluate(() => (window as any).__accountRequests[0].kind)).toBe('star');
});

test('account-first — an unrelated write failure keeps a generic result headline', async ({ page }) => {
  await boot(page);
  await installApplyGate(page);
  await page.evaluate(() => {
    (window as any).claudeSync.apply = async () => {
      (window as any).__accountEvidence.applyCalls += 1;
      throw new Error('Fixture file write failed');
    };
  });
  const dialog = await openSyncReview(page, 'en');
  await dialog.getByRole('button', { name: 'Sync 1 session', exact: true }).click();
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt).toHaveAttribute('data-verified', 'false');
  await expect(receipt.locator('.complete-card h1')).toHaveText('Operation could not finish');
  await expect(receipt.getByText('Fixture file write failed', { exact: true })).toBeVisible();
  await expect(receipt).not.toContainText('Sessions changed before syncing');
  await assertReceipt(page, 'en', false);
  expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);
});

test('account-first — failed recovery preserves the interruption journal without applying again', async ({ page }) => {
  await boot(page);
  await installApplyGate(page);
  const dialog = await openSyncReview(page, 'en');
  await dialog.getByRole('button', { name: 'Sync 1 session', exact: true }).click();
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
  await page.evaluate(() => (window as any).__accountEvidence.partialApply());
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt.locator('.complete-card h1')).toHaveText('Sync interrupted');
  const rows = receipt.locator('.partial-account-list li');
  await expect(rows).toHaveCount(3);
  // C had a planned change but is absent from the native outcome sets. Its outcome remains unknown.
  const plannedWithoutOutcome = rows.filter({ hasText: '33333333' });
  await expect(plannedWithoutOutcome).toHaveAttribute('data-outcome', 'unconfirmed');
  await expect(plannedWithoutOutcome).toContainText('Needs checking');
  await expect(plannedWithoutOutcome).not.toContainText('No changes planned');
  const originalRows = await rows.allTextContents();
  await page.evaluate(() => {
    (window as any).claudeSync.check = async () => { throw new Error('Fixture refresh failed after interruption'); };
  });
  await receipt.getByRole('button', { name: 'Refresh and review again', exact: true }).click();
  await expect(page.getByText('Fixture refresh failed after interruption', { exact: true })).toBeVisible();
  await expect(receipt.locator('.complete-card h1')).toHaveText('Sync interrupted');
  await expect(rows).toHaveText(originalRows);
  const details = receipt.locator('.receipt-error-details');
  await details.locator('summary').click();
  await expect(details).toContainText('Fixture operation interrupted');
  await expect(details).toContainText('fixture-backup');
  await expect(details.getByText(/fixture-backup/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__accountEvidence.applyCalls)).toBe(1);
});

test('account-first — review and receipt count only sessions and accounts with actual changes', async ({ page }) => {
  await boot(page);
  await installApplyGate(page);
  await page.evaluate(({ changedAccount }) => {
    const api = (window as any).claudeSync;
    const preview = api.preview;
    api.preview = async (request: any, revision: string) => {
      const result = await preview(request, revision);
      const changes = result.changes.filter((item: any) => item.sessionId === 'plan' && item.accountId === changedAccount);
      return { ...result, changes, fileCount: changes.length };
    };
  }, { changedAccount: B });
  await openList(page);
  for (const title of [TITLES[0], TITLES[1]]) await page.getByRole('checkbox', { name: title, exact: true }).check();
  await page.getByRole('button', { name: 'Review sync', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.review-accounts > span')).toHaveCount(3);
  await expect(dialog.locator('.review-changes li')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Sync 1 session', exact: true }).click();
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'progress');
  await page.evaluate(() => (window as any).__accountEvidence.finishApply());
  const receipt = page.locator('.stage-surface--complete');
  await expect(receipt.locator('.complete-card h1')).toHaveText('Synced 1 session');
  await expect(receipt.locator('.completion-list li')).toHaveCount(1);
  await expect(receipt.locator('.completion-list')).toContainText('Added to ' + EMAIL_B);
  await expect(receipt.locator('.completion-list')).not.toContainText(EMAIL_A);
  await expect(receipt.locator('.completion-list')).not.toContainText('33333333');
  await expect(receipt.locator('.completion-list')).not.toContainText(TITLES[1]!);
});

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
  const confirm = dialog.getByRole('button', { name: 'Sync 1 session', exact: true });
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
    dialog.getByRole('button', { name: 'Sync 1 session', exact: true })]) {
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  const body = await dialog.locator('.dialog-body').boundingBox();
  const actions = await dialog.locator('.dialog-actions').boundingBox();
  expect(body).not.toBeNull(); expect(actions).not.toBeNull();
  expect(body!.y + body!.height).toBeLessThanOrEqual(actions!.y + 1);
});