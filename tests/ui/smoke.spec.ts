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
  { name: 'narrow', width: 390, height: 844 },
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

const fixtureWorkspace: FixtureWorkspace = {
  checkedAt: NOW,
  revision: 'fixture-revision',
  accounts: [
    { id: ACCOUNT_A, email: undefined, scopes: ['fixture-alpha'], active: 3, archived: 0, total: 3, eligible: 3, copies: 3, current: true, visible: 3, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 },
    { id: ACCOUNT_B, email: undefined, scopes: ['fixture-beta'], active: 2, archived: 0, total: 2, eligible: 2, copies: 2, current: true, visible: 2, organizationVerified: true, scheduled: 0, oldCopies: 0, deletedMarkers: 0, unverified: 0 },
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
        { accountId: ACCOUNT_B, active: true, archived: false, eligible: true, copies: 1, titles: ['Synthetic sync session'], reasons: [], records: [{ scope: 'fixture-beta', group: 'visible', title: 'Synthetic sync session', project: 'fixture-project', updatedAt: NOW, archived: false, eligible: true, manageable: true, starred: false, reasons: [] }] },
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
  sessions: [{ id: 'fixture-cloud-session', title: 'Synthetic cloud session', status: 'archived', updatedAt: NOW, deletable: false, blockedReason: 'unsupported' }],
  limitReached: false,
};

const labels: Record<Locale, Record<'home' | 'local' | 'cloud' | 'backups' | 'settings' | 'cta', string>> = {
  'zh-CN': { home: '概览', local: '本机 Code 会话', cloud: '云端 Code 会话', backups: '备份与恢复', settings: '文件夹设置', cta: '检查聊天' },
  en: { home: 'Overview', local: 'Local Code sessions', cloud: 'Cloud Code sessions', backups: 'Backups and recovery', settings: 'Folder settings', cta: 'Check chats' },
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
    let pendingPreview: Record<string, unknown> | undefined;
    const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const api = {
      getInfo: async () => ({ version: 'fixture', configured: true, suggestedSessionRoot: 'fixture-session-root', suggestedProjectsRoot: 'fixture-projects' }),
      chooseDirectory: async () => 'fixture-directory',
      configure: async () => undefined,
      check: async () => copy(workspace),
      preview: async (request: { kind: string; sessionIds: string[]; accountIds: string[]; group?: string }) => {
        const selected = workspace.sessions.filter((session: { id: string }) => request.sessionIds.includes(session.id));
        const accountIds = request.accountIds.length ? request.accountIds : workspace.accounts.map((account: { id: string }) => account.id);
        pendingPreview = {
          group: request.group,
          kind: request.kind,
          changes: selected.flatMap((session: { id: string; title: string }) => accountIds.map((accountId: string) => ({ sessionId: session.id, title: session.title, accountId, action: request.kind === 'sync' ? 'update' : request.kind, copies: 1 }))),
          selected: selected.map((session: { id: string; title: string }) => ({ id: session.id, title: session.title })),
          accountIds,
          conflicts: [],
          progressUpdates: [],
          progressConflicts: [],
          skipped: [],
          fileCount: selected.length || 1,
        };
        return copy(pendingPreview);
      },
      apply: async () => ({ result: { filesChanged: 1, verified: true, backup: 'fixture-backup' }, workspace: copy(workspace) }),
      deleteSelected: async () => ({ result: { filesChanged: 1, verified: true, trashCount: 1 }, workspace: copy(workspace) }),
      previewOldCopies: async () => ({ items: [], accountIds: [], trashCount: 0, archivedToImport: 0 }),
      cleanupOldCopies: async () => ({ result: { trashed: 0, importedArchived: 0, mainUnchanged: true, oldCopiesRemaining: 0 }, workspace: copy(workspace) }),
      cloudSessions: async () => copy(cloud),
      deleteCloudSessions: async () => ({ deleted: 0, requested: 0, workspace: copy(cloud) }),
      backups: async () => [{ id: 'fixture-backup', createdAt: '2026-10-28T00:00:00.000Z', operation: 'sync', state: 'verified', fileCount: 1 }],
      previewRestore: async () => copy(pendingPreview),
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

async function assertNoChineseSystemText(page: Page): Promise<void> {
  const text = await page.locator('.claudesync-app').evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('select, option').forEach((element) => element.remove());
    return copy.textContent ?? '';
  });
  expect(text, 'English app-owned copy must not contain Chinese').not.toMatch(CHINESE);
}

async function openStage(page: Page, locale: Locale, stage: 'home' | 'local' | 'cloud' | 'backups' | 'settings'): Promise<void> {
  const button = page.getByRole('button', { name: labels[locale][stage], exact: true });
  await expect(button).toBeVisible();
  await button.click();
  const expectedDataStage = stage === 'home' ? 'home' : stage === 'local' ? 'results' : stage;
  await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', expectedDataStage);
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

      if (viewport.width > 900) {
        await openStage(page, locale, 'backups');
        await assertDecorativeImages(page, 'backup');
        if (locale === 'en') await assertNoChineseSystemText(page);

        await openStage(page, locale, 'settings');
        await assertDecorativeImages(page, 'settings');
        if (locale === 'en') await assertNoChineseSystemText(page);
      }
    });
  }
}

test('fixed renderer smoke — review footer and More menu stay clickable', async ({ page }) => {
  const viewport = VIEWPORTS[1]!;
  await openFixture(page, viewport, 'zh-CN');
  await openStage(page, 'zh-CN', 'local');
  await page.locator('.summary-card--aligned .summary-card-main').click();
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

test('polish — older label and review actions stay visible at 600px', async ({ page }) => {
  const cases: Array<{ locale: Locale; olderLabel: string; syncLabel: string; moreLabel: string }> = [
    { locale: 'zh-CN', olderLabel: '可以清理的旧聊天', syncLabel: '同步 1 条', moreLabel: '更多操作' },
    { locale: 'en', olderLabel: 'Older chats you can clean up', syncLabel: 'Sync 1', moreLabel: 'More actions' },
  ];
  for (const item of cases) {
    await openFixture(page, { name: 'narrow-600', width: 600, height: 900 }, item.locale);
    await openStage(page, item.locale, 'local');
    await expect(page.locator('.summary-card--older .summary-card-copy strong')).toHaveText(item.olderLabel);
    await page.locator('.summary-card--older .summary-card-main').click();
    await expect(page.locator('.claudesync-app')).toHaveAttribute('data-stage', 'review');
    await expect(page.getByText(item.olderLabel, { exact: true })).toHaveCount(2);
    await page.locator('.review-list-wrap input[type="checkbox"]:not(:disabled)').first().check();

    const footer = page.locator('.game-ui-page-surface-footer');
    const more = page.locator('.more-actions > summary');
    const sync = page.getByRole('button', { name: item.syncLabel, exact: true });
    await expect(footer).toBeVisible();
    await expect(more).toBeVisible();
    await expect(more).toHaveText(item.moreLabel);
    await expect(sync).toBeVisible();
    await assertInsideViewport(page, more, `${item.locale} More actions at 600px`);
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
