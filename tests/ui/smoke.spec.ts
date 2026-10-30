import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

type Locale = 'zh-CN' | 'en';
type Viewport = { name: string; width: number; height: number };

type FixtureWorkspace = {
  checkedAt: string;
  revision: string;
  accounts: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  blockers: string[];
  skippedPaths: string[];
  identityState: 'verified';
};

const VIEWPORTS: Viewport[] = [
  { name: 'mobile', width: 600, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
];
const LOCALES: Locale[] = ['zh-CN', 'en'];
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_SYNC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_OLDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ARCHIVED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = '2026-10-29T00:00:00.000Z';
const CHINESE = /[\u3400-\u9fff]/u;
const CONFIRM_SCOPE_REPORT = join(process.cwd(), '.reports/2026-10-30-confirm-scope');
const POLISH_REPORT = join(process.cwd(), '.reports/2026-10-30-polish-3');

const fixtureWorkspace: FixtureWorkspace = {
  checkedAt: NOW,
  revision: 'fixture-revision',
  accounts: [
    { id: ACCOUNT_A, email: 'account-a@fixture.invalid', scopes: ['fixture-alpha'], active: 2, archived: 1, total: 3, eligible: 2, copies: 3, current: true, visible: 2, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 },
    { id: ACCOUNT_B, email: 'account-b@fixture.invalid', scopes: ['fixture-beta'], active: 1, archived: 1, total: 2, eligible: 1, copies: 2, current: true, visible: 1, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 },
  ],
  sessions: [
    {
      id: SESSION_SYNC,
      title: 'Synthetic sync session',
      project: 'fixture-project',
      updatedAt: NOW,
      starred: false,
      manageable: true,
      presence: [
        { accountId: ACCOUNT_A, active: true, archived: false, eligible: true, copies: 1, titles: ['Synthetic sync session'], reasons: [], records: [{ scope: 'fixture-alpha', group: 'visible', title: 'Synthetic sync session', project: 'fixture-project', updatedAt: NOW, archived: false, eligible: true, manageable: true, starred: false, reasons: [] }] },
      ],
    },
    {
      id: SESSION_OLDER,
      title: 'Synthetic older session',
      project: 'fixture-project',
      updatedAt: '2026-09-01T00:00:00.000Z',
      starred: false,
      manageable: true,
      presence: [
        { accountId: ACCOUNT_A, active: true, archived: false, eligible: true, copies: 1, titles: ['Synthetic older session'], reasons: [], records: [{ scope: 'fixture-alpha', group: 'visible', title: 'Synthetic older session', project: 'fixture-project', updatedAt: '2026-09-01T00:00:00.000Z', archived: false, eligible: true, manageable: true, starred: false, reasons: [] }] },
      ],
    },
    {
      id: SESSION_ARCHIVED,
      title: 'Synthetic archived session',
      project: 'fixture-project',
      updatedAt: '2026-10-01T00:00:00.000Z',
      starred: false,
      manageable: true,
      presence: [
        { accountId: ACCOUNT_A, active: false, archived: true, eligible: true, copies: 1, titles: ['Synthetic archived session'], reasons: [], records: [{ scope: 'fixture-alpha', group: 'archived', title: 'Synthetic archived session', project: 'fixture-project', updatedAt: '2026-10-01T00:00:00.000Z', archived: true, eligible: true, manageable: true, starred: false, reasons: [] }] },
        { accountId: ACCOUNT_B, active: false, archived: true, eligible: true, copies: 1, titles: ['Synthetic archived session'], reasons: [], records: [{ scope: 'fixture-beta', group: 'archived', title: 'Synthetic archived session', project: 'fixture-project', updatedAt: '2026-10-01T00:00:00.000Z', archived: true, eligible: true, manageable: true, starred: false, reasons: [] }] },
      ],
    },
  ],
  blockers: [],
  skippedPaths: [],
  identityState: 'verified',
};

const fixtureCloud = {
  revision: 'fixture-cloud-revision',
  checkedAt: NOW,
  accountId: 'fixture-cloud-account',
  organizationId: 'fixture-cloud-organization',
  email: 'Synthetic cloud fixture',
  sessions: [
    { id: 'fixture-cloud-active', title: 'Synthetic active cloud session', status: 'active', updatedAt: NOW, deletable: true },
    { id: 'fixture-cloud-archived', title: 'Synthetic archived cloud session', status: 'archived', updatedAt: NOW, deletable: false, blockedReason: 'unsupported' },
  ],
  limitReached: false,
};

const labels: Record<Locale, Record<'home' | 'local' | 'cloud' | 'backups' | 'settings' | 'cta' | 'more', string>> = {
  'zh-CN': { home: '概览', local: '本机 Code 会话', cloud: '云端 Code 会话', backups: '备份与恢复', settings: '文件夹设置', cta: '检查聊天', more: '更多' },
  en: { home: 'Overview', local: 'Local Code sessions', cloud: 'Cloud Code sessions', backups: 'Backups and recovery', settings: 'Folder settings', cta: 'Check chats', more: 'More' },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function installFixture(page: Page, locale: Locale): Promise<void> {
  await page.addInitScript(({ initialWorkspace, cloud, selectedLocale }) => {
    localStorage.setItem('claudesync.locale', selectedLocale);
    localStorage.setItem('claudesync.theme', 'light');
    localStorage.removeItem('claudesync.compact');
    localStorage.removeItem('claudesync.reduced-motion');

    let workspace = JSON.parse(JSON.stringify(initialWorkspace));
    let cloudState = JSON.parse(JSON.stringify(cloud));
    let pendingPreview: Record<string, any> | undefined;
    const backup = {
      id: 'fixture-backup', createdAt: '2026-10-28T00:00:00.000Z', operation: 'sync', state: 'verified', fileCount: 1,
      affectedAccountIds: workspace.accounts.map((account: { id: string }) => account.id),
    };
    const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const applyWorkspaceChanges = (preview: Record<string, any> | undefined) => {
      if (!preview || !['archive', 'unarchive'].includes(preview.kind)) return;
      const changes = new Set(preview.changes.map((change: { sessionId: string; accountId: string }) => `${change.sessionId}:${change.accountId}`));
      workspace.sessions = workspace.sessions.map((session: { id: string; presence: Array<Record<string, any>> }) => ({
        ...session,
        presence: session.presence.map((presence) => {
          if (!changes.has(`${session.id}:${presence.accountId}`)) return presence;
          const archived = preview.kind === 'archive';
          return { ...presence, active: !archived, archived, records: presence.records?.map((record: Record<string, any>) => ({ ...record, active: !archived, archived, group: archived ? 'archived' : 'visible' })) };
        }),
      }));
    };
    const api = {
      getInfo: async () => ({ version: 'fixture', configured: true, suggestedSessionRoot: 'fixture-session-root', suggestedProjectsRoot: 'fixture-projects' }),
      chooseDirectory: async () => 'fixture-directory',
      configure: async () => undefined,
      check: async () => copy(workspace),
      preview: async (request: { kind: string; sessionIds: string[]; accountIds: string[]; group?: string }) => {
        const selected = workspace.sessions.filter((session: { id: string }) => request.sessionIds.includes(session.id));
        const requestedAccountIds: string[] = request.accountIds.length ? request.accountIds : workspace.accounts.map((account: { id: string }) => account.id);
        const changes: Array<{ sessionId: string; title: string; accountId: string; action: string; copies: number }> = selected.flatMap((session: { id: string; title: string; presence: Array<{ accountId: string; active: boolean; archived: boolean }> }) => {
          if (request.kind === 'sync') return requestedAccountIds.map((accountId) => ({ sessionId: session.id, title: session.title, accountId, action: session.presence.some((item) => item.accountId === accountId) ? 'update' : 'add', copies: 1 }));
          const presence = session.presence.filter((item) => requestedAccountIds.includes(item.accountId)
            && (request.kind === 'archive' ? item.active : request.kind === 'unarchive' ? item.archived : true));
          return presence.map((item) => ({ sessionId: session.id, title: session.title, accountId: item.accountId, action: request.kind, copies: 1 }));
        });
        const accountIds = [...new Set(changes.map((change) => change.accountId))];
        pendingPreview = {
          token: 'fixture-preview', group: request.group, kind: request.kind, changes,
          selected: selected.map((session: { id: string; title: string }) => ({ id: session.id, title: session.title })), accountIds,
          conflicts: [], progressUpdates: [], progressConflicts: [], skipped: [], fileCount: changes.length || 1,
        };
        return copy(pendingPreview);
      },
      apply: async () => {
        applyWorkspaceChanges(pendingPreview);
        const current = pendingPreview;
        pendingPreview = undefined;
        return { result: { filesChanged: current?.fileCount ?? 1, verified: true, backup: 'fixture-backup-after' }, workspace: copy(workspace) };
      },
      deleteSelected: async () => ({ result: { filesChanged: 1, verified: true, trashCount: 1 }, workspace: copy(workspace) }),
      previewOldCopies: async () => ({ items: [], accountIds: [], trashCount: 0, archivedToImport: 0 }),
      cleanupOldCopies: async () => ({ result: { trashed: 0, importedArchived: 0, mainUnchanged: true, oldCopiesRemaining: 0 }, workspace: copy(workspace) }),
      cloudSessions: async () => copy(cloudState),
      deleteCloudSessions: async (ids: string[], revision: string) => {
        const requested = ids.length;
        cloudState.sessions = cloudState.sessions.filter((session: { id: string }) => !ids.includes(session.id));
        return { deleted: requested, requested, workspace: copy(cloudState) };
      },
      backups: async () => [copy(backup)],
      previewRestore: async () => {
        const session = workspace.sessions[0];
        pendingPreview = { token: 'fixture-restore-preview', kind: 'restore', backup: copy(backup), changes: [{ sessionId: session.id, title: session.title, accountId: backup.affectedAccountIds[0], action: 'restore', copies: 1 }], selected: [], accountIds: copy(backup.affectedAccountIds), conflicts: [], skipped: [], fileCount: 1 };
        return copy(pendingPreview);
      },
      openBackups: async () => undefined,
    };
    Object.defineProperty(window, 'claudeSync', { configurable: true, value: api });
  }, { initialWorkspace: fixtureWorkspace, cloud: fixtureCloud, selectedLocale: locale });
}

async function openFixture(page: Page, viewport: Viewport, locale: Locale): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installFixture(page, locale);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'home');
  await expect(page.locator('.shell-brand strong')).toHaveText('ClaudeSync');
}

async function assertDecorativeImages(page: Page, expectedName: string): Promise<void> {
  const images = page.locator('img.relay-render, img.page-header-art');
  await expect.poll(async () => (await images.evaluateAll((elements) => elements.every((element) => (element as HTMLImageElement).naturalWidth > 0))), { timeout: 5_000 }).toBe(true);
  const details = await images.evaluateAll((elements) => elements.map((element) => ({
    naturalWidth: (element as HTMLImageElement).naturalWidth,
    alt: element.getAttribute('alt'),
    ariaHidden: element.getAttribute('aria-hidden'),
    source: (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src,
  })));
  expect(details.length, `3D ${expectedName} image must be present`).toBeGreaterThan(0);
  expect(details.every((item) => item.naturalWidth > 0), `3D ${expectedName} image must load`).toBe(true);
  expect(details.every((item) => item.alt === '' && item.ariaHidden === 'true'), `3D ${expectedName} image must be decorative`).toBe(true);
  expect(details.some((item) => item.source.includes(expectedName)), `3D image source must be ${expectedName}`).toBe(true);
  if (expectedName === 'home') expect(details.some((item) => item.source.includes('hero')), 'home must keep the hero image').toBe(true);
}

async function assertInsideViewport(page: Page, locator: Locator, message: string): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${message} must have a layout box`).not.toBeNull();
  expect(viewport, 'test viewport must exist').not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x, `${message} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${message} top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${message} right edge`).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, `${message} bottom edge`).toBeLessThanOrEqual(viewport.height);
}

async function assertNoOverlap(first: Locator, second: Locator, message: string): Promise<void> {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  expect(firstBox, `${message} first control must have a layout box`).not.toBeNull();
  expect(secondBox, `${message} second control must have a layout box`).not.toBeNull();
  if (!firstBox || !secondBox) return;
  const overlaps = firstBox.x < secondBox.x + secondBox.width && secondBox.x < firstBox.x + firstBox.width
    && firstBox.y < secondBox.y + secondBox.height && secondBox.y < firstBox.y + firstBox.height;
  expect(overlaps, `${message} bounding boxes must not overlap`).toBe(false);
}

async function assertNoChineseSystemText(page: Page): Promise<void> {
  const text = await page.locator('.claudesync-app').evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('select, option').forEach((element) => element.remove());
    return copy.textContent ?? '';
  });
  expect(text, 'English app-owned copy must not contain Chinese').not.toMatch(CHINESE);
}

async function polishShot(page: Page, name: string): Promise<void> {
  mkdirSync(POLISH_REPORT, { recursive: true });
  await page.screenshot({ path: join(POLISH_REPORT, `${name}.png`), animations: 'disabled', fullPage: false });
}

async function assertAboveMobileTabs(page: Page, locator: Locator, message: string): Promise<void> {
  const box = await locator.boundingBox();
  const tabs = page.locator('.game-ui-shell-mobile-nav');
  const tabsBox = await tabs.boundingBox();
  expect(box, `${message} must have a layout box`).not.toBeNull();
  expect(tabsBox, `${message} mobile tabs must have a layout box`).not.toBeNull();
  if (!box || !tabsBox) return;
  expect(box.y + box.height, `${message} must finish above the fixed tabs`).toBeLessThanOrEqual(tabsBox.y + 1);
}

async function openReviewMore(page: Page): Promise<void> {
  const more = page.locator('.more-actions > summary');
  await expect(more).toBeVisible();
  if (!(await page.locator('.more-actions').getAttribute('open'))) await more.click();
  await expect(page.locator('.more-actions > div')).toBeVisible();
}

async function openStage(page: Page, locale: Locale, stage: 'home' | 'local' | 'cloud'): Promise<void> {
  const button = page.getByRole('button', { name: labels[locale][stage], exact: true });
  await expect(button).toBeVisible();
  await button.click();
  const expectedDataStage = stage === 'home' ? 'home' : stage === 'local' ? 'results' : stage;
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', expectedDataStage);
}

async function openUtilityStage(page: Page, locale: Locale, stage: 'backups' | 'settings'): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) <= 900) {
    const more = page.locator('.mobile-nav-more > summary');
    const menuOpen = await page.locator('.mobile-nav-more').evaluate((element) => (element as HTMLDetailsElement).open);
    if (!menuOpen) await more.click();
    await expect(page.locator('.mobile-nav-more > div')).toBeVisible();
    const button = page.locator('.mobile-nav-more > div').getByRole('button', { name: labels[locale][stage], exact: true });
    await expect(button).toBeVisible();
    await button.click();
  } else {
    const button = page.getByRole('button', { name: labels[locale][stage], exact: true });
    await expect(button).toBeVisible();
    await button.click();
  }
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', stage);
}

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    test(`fixed renderer smoke — ${viewport.name} / ${locale}`, async ({ page }) => {
      await openFixture(page, viewport, locale);
      await assertDecorativeImages(page, 'home');
      await assertInsideViewport(page, page.getByRole('button', { name: labels[locale].cta, exact: true }), 'home primary CTA');
      if (locale === 'en') await assertNoChineseSystemText(page);

      await openStage(page, locale, 'local');
      await assertDecorativeImages(page, 'local');
      if (locale === 'en') await assertNoChineseSystemText(page);

      await openStage(page, locale, 'cloud');
      await assertDecorativeImages(page, 'cloud');
      if (locale === 'en') await assertNoChineseSystemText(page);

      await openUtilityStage(page, locale, 'backups');
      await assertDecorativeImages(page, 'backup');
      if (locale === 'en') await assertNoChineseSystemText(page);

      await openUtilityStage(page, locale, 'settings');
      await assertDecorativeImages(page, 'settings');
      if (locale === 'en') await assertNoChineseSystemText(page);
    });
  }
}

test('fixed renderer smoke — review footer and More menu stay clickable', async ({ page }) => {
  const viewport = VIEWPORTS[1]!;
  await openFixture(page, viewport, 'zh-CN');
  await openStage(page, 'zh-CN', 'local');
  await page.locator('.summary-card--recent .summary-card-main').click();
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
  await page.locator('.review-list-wrap input[type="checkbox"]:not(:disabled)').first().check();

  const primary = page.locator('.action-buttons > .game-ui-button-frame button, .action-buttons > button').first();
  await assertInsideViewport(page, primary, 'review primary action');
  await page.locator('.more-actions > summary').click();
  const menu = page.locator('.more-actions > div');
  await expect(menu).toBeVisible();
  const menuButtons = menu.locator('button');
  expect(await menuButtons.count(), 'More menu must contain guarded actions').toBeGreaterThan(0);
  for (let index = 0; index < await menuButtons.count(); index += 1) {
    const button = menuButtons.nth(index);
    await expect(button).toBeVisible();
    await assertInsideViewport(page, button, `More menu action ${index}`);
    const hitTarget = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
    expect(hitTarget, `More menu action ${index} must not be covered`).toBe(true);
  }
});

test('polish — search and select-all controls do not overlap in all eight review views', async ({ page }) => {
  const cases: Array<{ locale: Locale; width: number; height: number; theme: 'light' | 'dark' }> = [
    ...(['zh-CN', 'en'] as const).flatMap((locale) => [
      { locale, width: 600, height: 900, theme: 'light' as const },
      { locale, width: 600, height: 900, theme: 'dark' as const },
      { locale, width: 1440, height: 900, theme: 'light' as const },
      { locale, width: 1440, height: 900, theme: 'dark' as const },
    ]),
  ];
  for (const item of cases) {
    await openFixture(page, { name: `${item.width}-${item.theme}`, width: item.width, height: item.height }, item.locale);
    if (item.theme === 'dark') await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await openStage(page, item.locale, 'local');
    await page.locator('.summary-card--older .summary-card-main').click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
    await assertNoOverlap(page.locator('.review-tools input[type="search"]'), page.locator('.select-line'), `${item.locale} ${item.width}px ${item.theme} search/select-all`);
  }
});

test('confirm page scope evidence — one changed account and session at 600px and 1440px', async ({ page }) => {
  mkdirSync(CONFIRM_SCOPE_REPORT, { recursive: true });
  const cases: Array<{ locale: Locale; width: number; screenshot: string; archiveLabel: string; title: string; undo: string }> = [
    { locale: 'zh-CN', width: 600, screenshot: 'confirm-zh-600.png', archiveLabel: '归档 1 条', title: '确认这次整理', undo: '已归档的聊天会移到“已归档”分组；要恢复，请在那里选中它并选择“取消归档”。' },
    { locale: 'en', width: 600, screenshot: 'confirm-en-600.png', archiveLabel: 'Archive 1', title: 'Review this operation', undo: 'Archived chats move to the “Archived” group; to bring one back, select it there and choose “Unarchive selected.”' },
    { locale: 'zh-CN', width: 1440, screenshot: 'confirm-zh-1440.png', archiveLabel: '归档 1 条', title: '确认这次整理', undo: '已归档的聊天会移到“已归档”分组；要恢复，请在那里选中它并选择“取消归档”。' },
    { locale: 'en', width: 1440, screenshot: 'confirm-en-1440.png', archiveLabel: 'Archive 1', title: 'Review this operation', undo: 'Archived chats move to the “Archived” group; to bring one back, select it there and choose “Unarchive selected.”' },
  ];
  for (const item of cases) {
    await openFixture(page, { name: `confirm-${item.locale}-${item.width}`, width: item.width, height: 900 }, item.locale);
    await openStage(page, item.locale, 'local');
    await page.locator('.summary-card--older .summary-card-main').click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
    await page.locator('.review-list-wrap input[type="checkbox"]:not(:disabled)').first().check();
    await page.getByRole('button', { name: item.archiveLabel, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: item.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.review-accounts > span')).toHaveCount(1);
    await expect(dialog.locator('.review-changes li')).toHaveCount(1);
    await expect(dialog.getByText(item.undo, { exact: true })).toBeVisible();
    await page.screenshot({ path: join(CONFIRM_SCOPE_REPORT, item.screenshot), animations: 'disabled' });
  }
});

test('polish — secondary mobile navigation exposes backups and settings in both locales', async ({ page }) => {
  test.setTimeout(120_000);
  for (const viewport of VIEWPORTS) for (const locale of LOCALES) {
    await openFixture(page, viewport, locale);
    await polishShot(page, `navigation-before-${locale}-${viewport.width}`);
    if (viewport.width <= 900) {
      const more = page.locator('.mobile-nav-more > summary');
      await expect(more).toBeVisible();
      await expect(more).toHaveText(labels[locale].more);
      await more.click();
      await expect(page.locator('.mobile-nav-more > div').getByRole('button', { name: labels[locale].backups, exact: true })).toBeVisible();
      await expect(page.locator('.mobile-nav-more > div').getByRole('button', { name: labels[locale].settings, exact: true })).toBeVisible();
      await polishShot(page, `navigation-after-${locale}-${viewport.width}`);
    }
    await openUtilityStage(page, locale, 'backups');
    await expect(page.getByRole('heading', { name: labels[locale].backups, exact: true })).toBeVisible();
    await openUtilityStage(page, locale, 'settings');
    await expect(page.getByRole('heading', { name: labels[locale].settings, exact: true })).toBeVisible();
    if (locale === 'en') await assertNoChineseSystemText(page);
  }
});

test('polish — 600px results reserve the fixed tab safe area in both locales', async ({ page }) => {
  test.setTimeout(60_000);
  for (const locale of LOCALES) {
    await openFixture(page, { name: 'mobile', width: 600, height: 900 }, locale);
    await openStage(page, locale, 'local');
    const footer = page.locator('.results-cta small');
    await expect(footer).toBeVisible();
    await assertInsideViewport(page, footer, `${locale} results footer`);
    await assertAboveMobileTabs(page, footer, `${locale} results footer`);
    await polishShot(page, `results-safe-area-${locale}-600`);
  }
});

test('polish — sync, archive and unarchive receipts cover the 600/1440 EN/zh matrix', async ({ page }) => {
  test.setTimeout(180_000);
  const cases = [
    { kind: 'sync', card: 'recent', action: { 'zh-CN': '同步 1 条', en: 'Sync 1' }, receipt: { 'zh-CN': '已同步 1 条聊天。', en: 'Synced 1 chat.' }, destination: { 'zh-CN': '参与账号的本机 Code 会话', en: 'local Code sessions in included accounts' } },
    { kind: 'archive', card: 'older', action: { 'zh-CN': '归档 1 条', en: 'Archive 1' }, receipt: { 'zh-CN': '已归档 1 条聊天。', en: 'Archived 1 chat.' }, destination: { 'zh-CN': '已归档分组', en: 'Archived group' } },
    { kind: 'unarchive', card: 'recent', action: { 'zh-CN': '取消归档', en: 'Unarchive selected' }, receipt: { 'zh-CN': '已取消归档 1 条聊天。', en: 'Unarchived 1 chat.' }, destination: { 'zh-CN': '普通会话列表', en: 'Active chats' } },
  ] as const;
  for (const viewport of VIEWPORTS) for (const locale of LOCALES) for (const item of cases) {
    await openFixture(page, viewport, locale);
    await openStage(page, locale, 'local');
    await page.locator(`.summary-card--${item.card} .summary-card-main`).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
    if (item.kind === 'unarchive') {
      const archived = page.locator('details[data-group="archived"]');
      await expect(archived).toBeVisible();
      await archived.locator('> summary').click();
      await archived.locator('input[type="checkbox"]:not(:disabled)').first().check();
      await openReviewMore(page);
      await page.getByRole('button', { name: item.action[locale], exact: true }).click();
    } else {
      await page.locator('.review-list-wrap input[type="checkbox"]:not(:disabled)').first().check();
      await page.getByRole('button', { name: item.action[locale], exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: locale === 'en' ? 'Review this operation' : '确认这次整理', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.review-changes li')).toHaveCount(item.kind === 'sync' ? 2 : item.kind === 'unarchive' ? 2 : 1);
    await polishShot(page, `${item.kind}-preview-${locale}-${viewport.width}`);
    await dialog.getByRole('button', { name: locale === 'en' ? 'Confirm changes' : '确认执行', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.getByRole('heading', { name: item.receipt[locale], exact: true })).toBeVisible();
    await expect(page.locator('.complete-card header p')).toContainText(item.destination[locale]);
    await polishShot(page, `${item.kind}-complete-${locale}-${viewport.width}`);
    if (locale === 'en') await assertNoChineseSystemText(page);
  }
});

test('polish — restore preview, folder save, and cloud view/delete cover the 600/1440 EN/zh matrix', async ({ page }) => {
  test.setTimeout(240_000);
  for (const viewport of VIEWPORTS) for (const locale of LOCALES) {
    await openFixture(page, viewport, locale);
    await openUtilityStage(page, locale, 'backups');
    await expect(page.locator('.backup-list')).toBeVisible();
    await polishShot(page, `restore-before-${locale}-${viewport.width}`);
    await page.getByRole('button', { name: locale === 'en' ? 'Restore this backup' : '恢复这个备份', exact: true }).click();
    const restoreDialog = page.getByRole('dialog', { name: locale === 'en' ? 'Review this operation' : '确认这次整理', exact: true });
    await expect(restoreDialog).toBeVisible();
    await expect(restoreDialog.locator('.restore-backup-section')).toBeVisible();
    await expect(restoreDialog.locator('[data-backup-date]')).not.toHaveText('');
    await expect(restoreDialog.locator('[data-backup-accounts]')).toContainText(locale === 'en' ? 'account-a@fixture.invalid' : 'account-a@fixture.invalid');
    await expect(restoreDialog.locator('[data-backup-files]')).toContainText(locale === 'en' ? '1 file' : '1 个文件');
    await polishShot(page, `restore-preview-${locale}-${viewport.width}`);
    await restoreDialog.getByRole('button', { name: locale === 'en' ? 'Confirm changes' : '确认执行', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'complete');
    await expect(page.getByRole('heading', { name: /^(Restored backup from|已从).*$/u })).toBeVisible();
    await expect(page.locator('.complete-card header p')).toContainText(locale === 'en' ? 'original local file locations' : '原本机文件位置');
    await polishShot(page, `restore-complete-${locale}-${viewport.width}`);

    await openFixture(page, viewport, locale);
    await openUtilityStage(page, locale, 'settings');
    await polishShot(page, `settings-before-${locale}-${viewport.width}`);
    await page.getByRole('button', { name: locale === 'en' ? 'Save and check' : '保存并检查', exact: true }).click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'results');
    await expect(page.getByText(locale === 'en' ? 'Desktop shows 2 chats.' : '桌面版里，能看到 2 条聊天。', { exact: true })).toBeVisible();
    await polishShot(page, `settings-after-${locale}-${viewport.width}`);

    await openFixture(page, viewport, locale);
    await openStage(page, locale, 'cloud');
    await expect(page.locator('.cloud-filters select')).toHaveValue('all');
    await expect(page.getByText('Synthetic active cloud session', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic archived cloud session', { exact: true })).toBeVisible();
    await polishShot(page, `cloud-all-${locale}-${viewport.width}`);
    await page.getByRole('checkbox', { name: 'Synthetic active cloud session', exact: true }).check();
    await page.getByRole('button', { name: locale === 'en' ? 'Delete selected Code sessions' : '删除选中的 Code 会话', exact: true }).click();
    const cloudDialog = page.getByRole('dialog', { name: locale === 'en' ? 'Delete this 1 Code session?' : '确定要删除这 1 条 Code 会话吗？', exact: true });
    await expect(cloudDialog).toBeVisible();
    await polishShot(page, `cloud-delete-preview-${locale}-${viewport.width}`);
    await cloudDialog.getByRole('button', { name: locale === 'en' ? 'Delete' : '确定删除', exact: true }).click();
    await expect(page.getByText(locale === 'en' ? 'Verified deletion of 1 of 1 cloud Code session' : '已核实删除 1 / 1 条云端 Code 会话', { exact: false })).toBeVisible();
    await expect(page.getByText('Synthetic active cloud session', { exact: true })).toHaveCount(0);
    await polishShot(page, `cloud-delete-complete-${locale}-${viewport.width}`);
    if (locale === 'en') await assertNoChineseSystemText(page);
  }
});

test('polish — older cleanup names the archive action and keeps sync available at 600px', async ({ page }) => {
  const cases: Array<{ locale: Locale; olderLabel: string; cleanupTitle: string; statusLabel: string; archiveLabel: string; syncLabel: string; moreLabel: string }> = [
    { locale: 'zh-CN', olderLabel: '可以清理的旧聊天', cleanupTitle: '选好旧聊天，再归档。', statusLabel: '可归档', archiveLabel: '归档 1 条', syncLabel: '同步 1 条', moreLabel: '更多操作' },
    { locale: 'en', olderLabel: 'Older chats you can clean up', cleanupTitle: 'Choose older chats, then archive.', statusLabel: 'Ready to archive', archiveLabel: 'Archive 1', syncLabel: 'Sync 1', moreLabel: 'More actions' },
  ];
  for (const item of cases) {
    await openFixture(page, { name: 'narrow-600', width: 600, height: 900 }, item.locale);
    await openStage(page, item.locale, 'local');
    await expect(page.locator('.summary-card--older .summary-card-copy strong')).toHaveText(item.olderLabel);
    await page.locator('.summary-card--older .summary-card-main').click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
    await expect(page.getByText(item.olderLabel, { exact: true })).toHaveCount(2);
    await expect(page.getByRole('heading', { name: item.cleanupTitle, exact: true })).toBeVisible();
    await expect(page.getByText(item.statusLabel, { exact: true })).toBeVisible();
    await page.locator('.review-list-wrap input[type="checkbox"]:not(:disabled)').first().check();

    const footer = page.locator('.game-ui-page-surface-footer');
    const more = page.locator('.more-actions > summary');
    const archive = page.getByRole('button', { name: item.archiveLabel, exact: true });
    const sync = page.getByRole('button', { name: item.syncLabel, exact: true });
    await expect(footer).toBeVisible();
    await expect(more).toBeVisible();
    await expect(more).toHaveText(item.moreLabel);
    await expect(archive).toBeVisible();
    await expect(sync).toBeVisible();
    await assertInsideViewport(page, more, `${item.locale} More actions at 600px`);
    await assertInsideViewport(page, archive, `${item.locale} archive at 600px`);
    await assertInsideViewport(page, sync, `${item.locale} sync at 600px`);

    const geometry = await page.evaluate(() => {
      const row = document.querySelector('.review-list-wrap .session-row');
      const actionBar = document.querySelector('.game-ui-page-surface-footer');
      if (!row || !actionBar) return null;
      const rowBox = row.getBoundingClientRect();
      const actionBox = actionBar.getBoundingClientRect();
      return { rowBottom: rowBox.bottom, actionTop: actionBox.top };
    });
    expect(geometry, `${item.locale} review geometry`).not.toBeNull();
    if (geometry) expect(geometry.rowBottom, `${item.locale} first row must stay above actions`).toBeLessThanOrEqual(geometry.actionTop + 1);
  }
});
