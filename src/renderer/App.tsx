import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyDocumentLanguage, rememberLocale } from '@pieai/swimmer-i18n-kit/browser';
import { Badge, Button, Callout, Icon, IconButton, Input, PageSurface, Select, Shell, Toggle, type IconName } from '@pieai/swimmer-ui-kit';
import { I18nProvider, getInitialLocale, locales, useTranslation } from './i18n';
import type { AppLocale, TranslationKey } from './i18n';
import { SESSION_GROUPS, type OldCleanupPreview, type OperationPreview, type OperationRequest, type SessionGroup, type SessionView } from '../shared/contracts';
import { sessionsInGroup } from './session-groups';
import { AccountSidebar, CollapsedSessionGroup, DeleteConfirmation, FolderSetting, Modal, OperationReview, Panel, SessionRows, SkippedEntriesNotice, accountName, groupLabels } from './components';
import { filterSessions, type SessionFilter } from './session-selection';
import { useWorkspace } from './useWorkspace';
import { deletionSelection, type DeleteSelection } from './deletion-selection';
import { CloudSessions } from './CloudSessions';
import { TermTip } from './TermTip';
import { OldCleanupDialog } from './OldCleanupDialog';
import { errorMessage } from './errors';
import { GroupArt, RelayArt, type GroupVisual } from './visuals';

type Theme = 'light' | 'dark';
type Platform = 'mac' | 'windows';
type Stage = 'home' | 'scan' | 'results' | 'review' | 'progress' | 'complete' | 'cloud' | 'backups' | 'settings';
type ReviewCategory = 'recent' | 'older' | 'attention' | 'aligned' | 'all';

type ResultCategory = { ids: Set<string>; sessions: SessionView[] };

type ResultCategories = Record<ReviewCategory, ResultCategory>;

const languageNames: Record<AppLocale, string> = { 'zh-CN': '简体中文', en: 'English', ja: '日本語', es: 'Español', 'pt-BR': 'Português' };
const excludedKey = 'claudesync.excluded-account-ids';
const themeKey = 'claudesync.theme';
const compactKey = 'claudesync.compact';
const reducedMotionKey = 'claudesync.reduced-motion';

function readExcluded(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(excludedKey) ?? localStorage.getItem('claudesync.excluded-account-scopes') ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((item): item is string => typeof item === 'string').map((item) => item.split('/')[0]!))] : [];
  } catch { return []; }
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* localStorage is optional in tests and restricted shells. */ }
  return 'light';
}

function readBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}

// The window follows the system: Mac gets the translucent sidebar, Windows the plain one.
function systemPlatform(): Platform {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'windows' : 'mac';
}

const categoryLabels: Record<ReviewCategory, TranslationKey> = {
  recent: 'categoryRecent', older: 'categoryOlder', attention: 'categoryAttention', aligned: 'categoryAligned', all: 'categoryAll',
};

const categoryVisuals: Record<Exclude<ReviewCategory, 'all'>, GroupVisual> = {
  recent: 'recent', older: 'older', attention: 'attention', aligned: 'aligned',
};

function homeAccountLabel(index: number, t: ReturnType<typeof useTranslation>): string {
  return index === 0 ? t.t('personalAccount') : index === 1 ? t.t('workAccount') : t.t('accountNumber', { count: index + 1 });
}

function homeAccountLabels(ids: Iterable<string>, t: ReturnType<typeof useTranslation>): string {
  const labels = [...ids].map((_, index) => homeAccountLabel(index, t));
  return labels.join(t.locale === 'zh-CN' ? '、' : ', ');
}

const navItems: Array<{ stage: Stage; label: TranslationKey; icon: IconName }> = [
  { stage: 'home', label: 'overview', icon: 'home' },
  { stage: 'results', label: 'localSessions', icon: 'scroll' },
  { stage: 'cloud', label: 'cloudSessions', icon: 'globe' },
];

function visibleRecordsForAccount(session: SessionView, accountFilter: string, included: Set<string>) {
  return session.presence.filter((item) => accountFilter === 'all' ? included.has(item.accountId) : item.accountId === accountFilter);
}

function classifyVisibleSessions(sessions: SessionView[], included: Set<string>): ResultCategories {
  const result: ResultCategories = {
    recent: { ids: new Set(), sessions: [] },
    older: { ids: new Set(), sessions: [] },
    attention: { ids: new Set(), sessions: [] },
    aligned: { ids: new Set(), sessions: [] },
    all: { ids: new Set(), sessions: sessions.slice() },
  };
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const session of sessions) {
    const presence = session.presence.filter((item) => included.has(item.accountId));
    const eligible = presence.some((item) => item.eligible);
    const aligned = included.size > 0 && [...included].every((accountId) => presence.some((item) => item.accountId === accountId && item.active));
    const category: Exclude<ReviewCategory, 'all'> = !session.manageable || !eligible
      ? 'attention'
      : aligned ? 'aligned'
      : session.updatedAt && Date.parse(session.updatedAt) >= recentCutoff ? 'recent' : 'older';
    result[category].ids.add(session.id);
    result[category].sessions.push(session);
    result.all.ids.add(session.id);
  }
  return result;
}

function ResultCard({ kind, title, count, copy, canSync, onView, onSync }: {
  kind: Exclude<ReviewCategory, 'all'>; title: string; count: number; copy: string; canSync: boolean;
  onView(): void; onSync(): void;
}) {
  const t = useTranslation();
  return <article className={`summary-card summary-card--${kind}`} data-empty={count === 0 || undefined}>
    <button type="button" className="summary-card-main" onClick={onView} aria-label={`${title} · ${t.t(kind === 'attention' ? 'viewReasons' : 'viewGroup')}`}>
      <GroupArt kind={categoryVisuals[kind]} />
      <span className="summary-card-copy"><strong>{title}</strong><span>{copy}</span></span>
      <span className="summary-card-count">{count}</span>
    </button>
    {canSync && count > 0 && <button type="button" className="summary-card-sync" onClick={onSync}>{t.t('syncCount', { count })}<Icon icon="arrow-right" /></button>}
  </article>;
}

function AppContent({ locale, onLocale }: { locale: AppLocale; onLocale(locale: AppLocale): void }) {
  const t = useTranslation();
  const model = useWorkspace();
  const { info, workspace } = model;
  const [stage, setStage] = useState<Stage>('home');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const platform = systemPlatform();
  const [compact, setCompact] = useState(() => readBoolean(compactKey));
  const [reducedMotion, setReducedMotion] = useState(() => readBoolean(reducedMotionKey));
  const [hasChecked, setHasChecked] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [oldPreview, setOldPreview] = useState<OldCleanupPreview>();
  const [cleanupFeedback, setCleanupFeedback] = useState('');
  const busy = model.busy || cloudBusy || cleanupBusy;
  const onCloudBusy = useCallback((value: boolean) => setCloudBusy(value), []);
  const [excluded, setExcluded] = useState(readExcluded);
  const [accountFilter, setAccountFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionGroup, setSelectionGroup] = useState<SessionGroup>('visible');
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory>('recent');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('active');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const [sessionRoot, setSessionRoot] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [deleting, setDeleting] = useState<(DeleteSelection & { revision: string; names: string[] })>();
  const [celebrate, setCelebrate] = useState(false);
  const [lastPreview, setLastPreview] = useState<OperationPreview>();

  useEffect(() => applyDocumentLanguage(t.locale, t.direction), [t.locale, t.direction]);
  useEffect(() => { if (info) { setSessionRoot(info.suggestedSessionRoot); setProjectsRoot(info.suggestedProjectsRoot); } }, [info]);
  useEffect(() => { try { localStorage.setItem(themeKey, theme); } catch { /* best effort */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(compactKey, String(compact)); } catch { /* best effort */ } }, [compact]);
  useEffect(() => { try { localStorage.setItem(reducedMotionKey, String(reducedMotion)); } catch { /* best effort */ } }, [reducedMotion]);

  const included = useMemo(() => new Set(workspace?.accounts.filter((account) => !excluded.includes(account.id)).map((account) => account.id) ?? []), [workspace, excluded]);
  const scopedGroups = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) =>
    [group, sessionsInGroup(workspace?.sessions ?? [], group, accountFilter, included)])) as Record<SessionGroup, SessionView[]>, [workspace, accountFilter, included]);
  const grouped = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) => [group,
    filterSessions(scopedGroups[group], { included, accountId: accountFilter, filter: group !== 'visible' && filter === 'active' ? 'all' : filter, search, sort }),
  ])) as Record<SessionGroup, SessionView[]>, [scopedGroups, included, accountFilter, filter, search, sort]);
  const categories = useMemo(() => classifyVisibleSessions(scopedGroups.visible, included), [scopedGroups.visible, included]);
  const displayedAccounts = workspace?.accounts.filter((account) => accountFilter === 'all' ? included.has(account.id) : account.id === accountFilter) ?? [];
  const listVerified = displayedAccounts.length > 0 && displayedAccounts.every((account) => account.organizationVerified);
  const markerCount = displayedAccounts.reduce((sum, account) => sum + account.deletedMarkers, 0);
  const reviewSessions = useMemo(() => {
    const source = reviewCategory === 'all' ? grouped.visible : grouped.visible.filter((session) => categories[reviewCategory].ids.has(session.id));
    return source;
  }, [categories, grouped.visible, reviewCategory]);
  const eligibleToSelect = reviewSessions.filter((session) => session.manageable && session.presence.some((item) => included.has(item.accountId) && item.eligible));
  const hiddenSelected = [...selected].filter((id) => !reviewSessions.some((session) => session.id === id)).length;
  const deleteTargets = useMemo(() => ({ ...deletionSelection(scopedGroups[selectionGroup], selected, included, accountFilter), group: selectionGroup }), [scopedGroups, selectionGroup, selected, included, accountFilter]);
  const listCount = categories.all.sessions.length;
  const syncableCount = categories.recent.sessions.length + categories.older.sessions.length;
  const targetsVerified = workspace?.accounts.filter((account) => included.has(account.id)).every((account) => account.organizationVerified) ?? false;
  const canAct = selected.size > 0 && included.size > 0 && !busy;
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => scopedGroups[selectionGroup].some((session) => session.id === id && session.presence.some((item) => included.has(item.accountId))))));
  }, [scopedGroups, selectionGroup, included]);

  function includeAccount(id: string, value: boolean) {
    const next = value ? excluded.filter((item) => item !== id) : [...new Set([...excluded, id])];
    setExcluded(next); localStorage.setItem(excludedKey, JSON.stringify(next));
  }

  function toggle(group: SessionGroup, id: string, value: boolean) {
    if (!grouped[group].some((session) => session.id === id && session.manageable && session.presence.some((item) => included.has(item.accountId)))) return;
    setSelected((current) => { const next = selectionGroup === group ? new Set(current) : new Set<string>(); if (value) next.add(id); else next.delete(id); return next; });
    setSelectionGroup(group);
  }

  async function startCheck() {
    setHasChecked(true);
    setStage('scan');
    await model.refresh();
    setStage('results');
  }

  function openReview(category: ReviewCategory, preselect = false) {
    setReviewCategory(category);
    setSelectionGroup('visible');
    const ids = category === 'all' ? [...categories.recent.sessions, ...categories.older.sessions] : categories[category].sessions;
    setSelected(preselect ? new Set(ids.filter((session) => session.manageable && session.presence.some((item) => included.has(item.accountId) && item.eligible)).map((session) => session.id)) : new Set());
    setStage('review');
  }

  async function action(kind: OperationRequest['kind'], title?: string) {
    if (!workspace) return;
    const accountIds = kind === 'sync' || kind === 'keep' || accountFilter === 'all' ? [...included] : included.has(accountFilter) ? [accountFilter] : [];
    await model.preview({ kind, group: selectionGroup, sessionIds: [...selected], accountIds, title });
  }

  async function applyOperation() {
    if (model.review) setLastPreview(model.review);
    setStage('progress');
    await model.apply();
    setCelebrate(!model.error);
    setStage('complete');
  }

  async function applyDeletion(request: DeleteSelection & { revision: string; names: string[] }) {
    setStage('progress');
    const success = await model.deleteSelected(request, request.revision);
    setCelebrate(false);
    if (success) setSelected(new Set());
    setStage('complete');
  }

  async function reviewOldCopies() {
    if (!workspace || !model.api) return;
    const ids = accountFilter === 'all' ? [...included] : included.has(accountFilter) ? [accountFilter] : [];
    if (!ids.length) return;
    setCleanupBusy(true); setCleanupFeedback('');
    try {
      const preview = await model.api.previewOldCopies(ids, workspace.revision);
      if (!preview.items.length) setCleanupFeedback(t.t('cleanupNone'));
      else setOldPreview(preview);
    } catch (error) { setCleanupFeedback(errorMessage(error)); }
    finally { setCleanupBusy(false); }
  }

  async function confirmOldCopies() {
    if (!oldPreview || !model.api) return;
    const token = oldPreview.token;
    setCleanupBusy(true); setCleanupFeedback('');
    try {
      const delivered = await model.api.cleanupOldCopies(token);
      setOldPreview(undefined);
      setCleanupFeedback(t.t('cleanupComplete', { trashed: delivered.result.trashed, imported: delivered.result.importedArchived }));
      await model.refresh();
    } catch (error) {
      setOldPreview(undefined);
      setCleanupFeedback(errorMessage(error));
      await model.refresh();
    } finally { setCleanupBusy(false); }
  }

  async function saveFolders() {
    const success = await model.configure(sessionRoot, projectsRoot);
    if (success) setStage('results');
  }

  async function openBackups() {
    const success = await model.loadBackups();
    if (success) setStage('backups');
  }

  function navigate(next: Stage) {
    if (busy) return;
    if (next === 'cloud' && stage === 'cloud') setCloudRefresh((value) => value + 1);
    setStage(next);
  }

  const feedback = <div className="shell-feedback" role="status" aria-live="polite">
    {model.error && <Callout heading={t.t('issue')} tone="danger">{model.error}</Callout>}
    {cleanupFeedback && <Callout tone="warning">{cleanupFeedback}</Callout>}
  </div>;

  function sidebar() {
    return <>
      <div className="shell-brand"><span className="shell-brand-mark"><Icon icon="check" /></span><strong>ClaudeSync</strong></div>
      <nav aria-label={t.t('sources')}>
        {navItems.map((item) => <button key={item.stage} type="button" data-current={stage === item.stage || (item.stage === 'results' && stage === 'review')} onClick={() => navigate(item.stage)}>
          <Icon icon={item.icon} /><span>{t.t(item.label)}</span>
        </button>)}
      </nav>
      <nav className="shell-sidebar-bottom" aria-label={t.t('settings')}>
        <button type="button" data-current={stage === 'backups'} onClick={() => void openBackups()} disabled={!workspace || busy}><Icon icon="history" /><span>{t.t('backupTitle')}</span></button>
        <button type="button" data-current={stage === 'settings'} onClick={() => navigate('settings')}><Icon icon="settings" /><span>{t.t('settings')}</span></button>
      </nav>
    </>;
  }

  function mobileNav() {
    return <nav className="mobile-nav-links" aria-label={t.t('sources')}>
      {navItems.map((item) => <button key={item.stage} type="button" data-current={stage === item.stage || (item.stage === 'results' && stage === 'review')} onClick={() => navigate(item.stage)}><Icon icon={item.icon} /><span>{t.t(item.label)}</span></button>)}
    </nav>;
  }

  function windowBar() {
    const stageLabel = stage === 'home' ? t.t('overview') : stage === 'review' ? t.t('reviewTitle') : stage === 'results' ? t.t('localSessions') : stage === 'settings' ? t.t('settings') : stage === 'backups' ? t.t('backupTitle') : stage === 'cloud' ? t.t('cloudSessions') : t.t('checking');
    return <><span className="shell-window-title">{stageLabel}</span><span className="shell-window-actions">
      {stage === 'cloud' && <IconButton label={t.t('checkAgain')} onClick={() => setCloudRefresh((value) => value + 1)} disabled={busy}><Icon icon="redo" /></IconButton>}
      <IconButton label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon icon={theme === 'dark' ? 'sun' : 'moon'} /></IconButton>
    </span></>;
  }

  function renderHome() {
    const configured = Boolean(info?.configured);
    const heroTitle = t.t('heroTitle').replace(/([,，、])\s*/u, '$1\n');
    return <PageSurface className="stage-surface stage-surface--home" title={heroTitle} description={t.t('heroBody')}>
      <div className="home-stage">
        <div className="home-art"><RelayArt state="ready" /></div>
        <ul className="home-scope-list">
          <li><Icon icon="scroll" /><span><strong>{t.t('localSessions')} · {t.t('cloudSessions')}</strong><small>{t.t('homeLocalBody')}</small></span></li>
          <li><Icon icon="user" /><span><strong>{homeAccountLabels(included, t) || t.t('unverifiedCount')}</strong><button type="button" className="inline-action" onClick={() => navigate('settings')}>{t.t('viewScope')}</button></span></li>
          <li><Icon icon="lock" /><span><strong>{t.t('homeSafety')}</strong></span></li>
        </ul>
        <div className="hero-actions"><Button variant="primary" disabled={busy} onClick={() => configured ? void startCheck() : navigate('settings')}><Icon icon={configured ? 'search' : 'scroll'} />{configured ? (hasChecked ? t.t('checkAgain') : t.t('checkChats')) : t.t('noDesktopAction')}</Button><small>{t.t('firstCheckHint')}</small></div>
      </div>
    </PageSurface>;
  }

  function renderScan() {
    return <PageSurface className="stage-surface stage-surface--state" layout="centered" title={t.t('checking')} description={t.t('heroBody')}>
      <div className="state-stage"><RelayArt state="scanning" /><div className="liquid-progress" aria-hidden="true"><span /></div><p>{t.t('checking')}</p><small>{t.t('localOnly')}</small></div>
    </PageSurface>;
  }

  function renderResults() {
    if (!workspace) return <PageSurface className="stage-surface" layout="centered" title={t.t('noCheck')} description={t.t('heroBody')} primaryAction={<Button variant="primary" onClick={() => void startCheck()}>{t.t('checkAgain')}</Button>}><div className="empty-state">{t.t('noCheck')}</div></PageSurface>;
    const resultTitle = listCount ? t.t('resultsTitle', { count: listCount }) : t.t('noSessions');
    const resultBody = t.t('resultsBody', { count: syncableCount });
    const otherCount = scopedGroups.archived.length + scopedGroups.scheduled.length + scopedGroups.oldOrganization.length;
    const firstAction = syncableCount ? <Button variant="primary" disabled={busy || included.size < 2 || !targetsVerified} onClick={() => openReview('all', true)}>{t.t('syncCount', { count: syncableCount })}</Button>
      : <Button variant="primary" onClick={() => openReview(categories.attention.sessions.length ? 'attention' : 'aligned')}>{categories.attention.sessions.length ? t.t('categoryAttention') : t.t('categoryAligned')}</Button>;
    return <PageSurface className="stage-surface stage-surface--results" title={resultTitle} description={resultBody} header={<button type="button" className="plain-action" onClick={() => navigate('settings')}>{t.t('viewScope')}</button>}>
      <div className="results-body">
        <div className="summary-grid">
          {(['recent', 'older', 'attention', 'aligned'] as const).map((kind) => <ResultCard key={kind} kind={kind} title={t.t(categoryLabels[kind])} count={categories[kind].sessions.length}
            copy={kind === 'recent' ? t.t('categoryRecentCopy') : kind === 'older' ? t.t('categoryOlderCopy') : kind === 'attention' ? t.t('categoryAttentionCopy') : t.t('categoryAlignedCopy')}
            canSync={kind === 'recent' || kind === 'older'} onView={() => openReview(kind)} onSync={() => openReview(kind, true)} />)}
        </div>
        <div className="results-cta">{firstAction}<small>{listVerified ? t.t('visibleCount', { shown: grouped.visible.length, total: scopedGroups.visible.length }) : t.t('unverifiedCount')} · {t.t('localOnly')}</small></div>
        {otherCount > 0 && <details className="other-records"><summary><Icon icon="arrow-right" />{t.t('otherRecords', { count: otherCount })}</summary><div className="other-records-grid">
          {(['archived', 'scheduled', 'oldOrganization'] as const).map((group) => <div key={group}><strong>{t.t(groupLabels[group])}</strong><Badge tone="neutral">{scopedGroups[group].length}</Badge></div>)}
        </div></details>}
        {workspace.skippedPaths.length > 0 && <SkippedEntriesNotice paths={workspace.skippedPaths} />}
      </div>
    </PageSurface>;
  }

  function renderReview() {
    if (!workspace) return renderResults();
    const categoryItems: Array<Exclude<ReviewCategory, 'all'>> = ['recent', 'older', 'attention', 'aligned'];
    const reviewTitle = reviewCategory === 'all' ? '' : t.t(categoryLabels[reviewCategory]);
    const allSelected = reviewSessions.length > 0 && eligibleToSelect.length > 0 && eligibleToSelect.every((session) => selected.has(session.id));
    const someSelected = eligibleToSelect.some((session) => selected.has(session.id));
    const selectedAccountCount = new Set(scopedGroups[selectionGroup].filter((session) => selected.has(session.id)).flatMap((session) => session.presence.filter((item) => included.has(item.accountId)).map((item) => item.accountId))).size;
    const selectedSyncableCount = eligibleToSelect.filter((session) => selected.has(session.id)).length;
    const reviewActions = <div className="review-footer-actions">
      <div className="selection-summary"><strong>{t.t('selectionSummary', { count: selected.size, accounts: selectedAccountCount })}</strong><span>{hiddenSelected > 0 ? t.t('hiddenSelected', { count: hiddenSelected }) : t.t('selectedCanSync', { count: selectedSyncableCount })}</span></div>
      <div className="action-buttons"><Button variant="primary" disabled={!canAct || included.size < 2 || !targetsVerified} onClick={() => void action('sync')}>{selectedSyncableCount ? t.t('syncCount', { count: selectedSyncableCount }) : t.t('syncNow')}</Button>
        <details className="more-actions"><summary>{t.t('more')}</summary><div>
          <Button variant="ghost" static disabled={!canAct || included.size < 2 || !targetsVerified} onClick={() => void action('keep')}>{t.t('keep')}</Button>
          <Button variant="ghost" static disabled={!canAct} onClick={() => void action('archive')}>{t.t('archive')}</Button>
          <Button variant="ghost" static disabled={!canAct} onClick={() => void action('unarchive')}>{t.t('unarchive')}</Button>
          <Button variant="ghost" static disabled={!canAct || selected.size !== 1} onClick={() => { setNewTitle(scopedGroups[selectionGroup].find((session) => selected.has(session.id))?.title || ''); setRenameOpen(true); }}>{t.t('rename')}</Button>
          <Button variant="ghost" static disabled={!canAct} onClick={() => void action('star')}>{t.t('star')}</Button>
          <Button variant="ghost" static disabled={!canAct} onClick={() => void action('unstar')}>{t.t('unstar')}</Button>
          <Button variant="danger" static disabled={busy || !deleteTargets.sessionIds.length} onClick={() => setDeleting({ ...deleteTargets, revision: workspace.revision, names: deleteTargets.accountIds.map((id) => accountName(workspace.accounts.find((account) => account.id === id), t)) })}>{t.t('delete')}</Button>
          <span className="count-with-tip"><Button variant="ghost" static disabled={busy || !listVerified || grouped.oldOrganization.length === 0} onClick={() => void reviewOldCopies()}>{t.t('cleanupOldButton')}</Button><TermTip term="oldCleanup" /></span>
        </div></details>
      </div>
    </div>;
    return <PageSurface className="stage-surface stage-surface--review" title={t.t('reviewTitle')} description={t.t('reviewBody', { count: listCount, syncable: syncableCount })} layout="split" aside={<aside className="review-aside">
      <div className="review-category-heading"><strong>{t.t('categoryAll')}</strong><span className="review-total">{listCount}</span></div>
      <div className="review-categories">{categoryItems.map((category) => <button type="button" key={category} className={`review-category ${reviewCategory === category ? 'is-active' : ''}`} aria-pressed={reviewCategory === category} onClick={() => { setReviewCategory(category); setSelectionGroup('visible'); }}><span>{t.t(categoryLabels[category])}</span><span className="review-category-count">{categories[category].sessions.length}</span></button>)}</div>
      <div className="review-scope"><details><summary>{t.t('viewScope')}</summary><AccountSidebar accounts={workspace.accounts} included={included} currentFilter={accountFilter} onInclude={includeAccount} onFilter={(id) => { setAccountFilter(id); setSelected(new Set()); setSelectionGroup('visible'); }} busy={busy} identityState={workspace.identityState} /></details></div>
    </aside>} footer={reviewActions}>
      <section className="review-main">
        <SkippedEntriesNotice paths={workspace.skippedPaths} />
        <div className="review-toolbar"><div>{reviewTitle && <><h2>{reviewTitle}</h2><small>{reviewSessions.length} 条</small></>}</div><div className="review-tools"><Input type="search" aria-label={t.t('search')} placeholder={t.t('search')} value={search} onChange={(event) => setSearch(event.target.value)} /><details className="filter-drawer"><summary>{t.t('filter')}</summary><div><label>{t.t('filter')}<Select aria-label={t.t('filter')} value={filter} onChange={(event) => setFilter(event.target.value as SessionFilter)}>{(['active', 'all', 'syncable', 'blocked', 'starred'] as const).map((key) => <option key={key} value={key}>{t.t(key)}</option>)}</Select></label><label>{t.t('sort')}<Select aria-label={t.t('sort')} value={sort} onChange={(event) => setSort(event.target.value as 'updated' | 'title')}><option value="updated">{t.t('sortUpdated')}</option><option value="title">{t.t('sortTitle')}</option></Select></label></div></details></div></div>
        <div className="select-line"><label><input type="checkbox" checked={allSelected} disabled={busy || !eligibleToSelect.length} ref={(element) => { if (element) element.indeterminate = someSelected && !allSelected; }} onChange={(event) => { const value = event.target.checked; setSelected((current) => { const next = selectionGroup === 'visible' ? new Set(current) : new Set<string>(); for (const session of eligibleToSelect) { if (value) next.add(session.id); else next.delete(session.id); } return next; }); setSelectionGroup('visible'); }} />{t.t('selectVisible')}</label><details className="selection-menu"><summary>{t.t('selectMenu')}</summary><div><Button variant="ghost" static disabled={busy} onClick={() => { setSelectionGroup('visible'); setSelected(new Set(eligibleToSelect.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 10).map((session) => session.id))); }}>{t.t('selectTen')}</Button>{selected.size > 0 && <Button variant="ghost" static disabled={busy} onClick={() => setSelected(new Set())}>{t.t('clearSelection')}</Button>}</div></details></div>
        <div className="review-list-wrap"><SessionRows sessions={reviewSessions} accounts={workspace.accounts} selected={selectionGroup === 'visible' ? selected : new Set()} filterId={accountFilter} included={included} onToggle={(id, value) => toggle('visible', id, value)} busy={busy} />
          {(['archived', 'scheduled', 'oldOrganization', 'deleted', 'unverified'] as const).map((group) => <CollapsedSessionGroup key={`${accountFilter}-${group}`} group={group} sessions={grouped[group]} accounts={workspace.accounts} selected={selectionGroup === group ? selected : new Set()} filterId={accountFilter} included={included} onToggle={(id, value) => toggle(group, id, value)} onCollapse={() => { if (selectionGroup === group) setSelected(new Set()); }} busy={busy} markerCount={markerCount} />)}
        </div>
        {!targetsVerified && <div className="operation-warning count-with-tip"><span>{t.t('unverifiedWrite')}</span><TermTip term="unverified" /></div>}
        {cleanupFeedback && <Callout tone="warning">{cleanupFeedback}</Callout>}
      </section>
    </PageSurface>;
  }

  function renderProgress() {
    return <PageSurface className="stage-surface stage-surface--state" layout="centered" title={t.t('operationInProgress')} description={t.t('operationInProgressBody')}>
      <div className="state-stage"><RelayArt state="syncing" /><div className="liquid-progress liquid-progress--wide" aria-label={t.t('operationInProgress')}><span /></div><p>{t.t('applying')}</p><small>{t.t('waiting')}</small></div>
    </PageSurface>;
  }

  function renderComplete() {
    const failed = Boolean(model.error);
    const title = failed ? t.t('issue') : model.deleted ? t.t('deleteComplete') : lastPreview?.kind === 'sync' ? t.t('syncCompleteCount', { count: lastPreview.selected.length }) : t.t('operationCompleteTitle');
    const description = failed ? model.error : model.deleted ? t.t('deleteComplete') : t.t('operationCompleteBody');
    const completedItems = lastPreview?.selected.length ? lastPreview.selected.map((item) => ({
      title: item.title || t.t('untitled'),
      targets: [...new Set(lastPreview.changes.filter((change) => change.sessionId === item.id).map((change) => homeAccountLabel([...included].indexOf(change.accountId), t)))].join('、') || lastPreview.accountIds.map((id) => homeAccountLabel([...included].indexOf(id), t)).join('、'),
    })) : [];
    return <PageSurface className="stage-surface stage-surface--complete" title={title} description={description}>
      <div className="complete-layout"><aside className="complete-art"><RelayArt state={failed ? 'attention' : 'complete'} celebrate={celebrate} /></aside><section className="complete-card">
        <header><h1>{title}</h1><p>{description}</p></header>
        {failed && <Callout tone="danger">{model.error}</Callout>}
        <p className="complete-proof">{t.t('complete')}</p><ul className="completion-list">{completedItems.length ? completedItems.map((item) => <li key={item.title}><Icon icon="check" /><strong>{item.title}</strong><span>{item.targets}</span></li>) : <><li><Icon icon={failed ? 'alert' : 'check'} /><strong>{failed ? t.t('issue') : model.deleted ? t.t('deleteComplete') : t.t('complete')}</strong><span>{workspace ? t.t('checkedAt', { time: t.date(workspace.checkedAt, { timeStyle: 'short' }) }) : ''}</span></li><li><Icon icon="lock" /><strong>{t.t('localOnly')}</strong><span>{t.t('operationCompleteBody')}</span></li></>}</ul>
        <footer><Button variant="ghost" static onClick={() => setStage('review')}>{t.t('viewScope')}</Button><Button variant="primary" onClick={() => { setCelebrate(false); setReviewCategory('all'); setStage(workspace ? 'review' : 'home'); }}>{t.t('returnToChats')}</Button></footer>
      </section></div>
    </PageSurface>;
  }

  function renderSettings() {
    return <PageSurface className="stage-surface stage-surface--settings" layout="centered" title={t.t('settings')} primaryAction={<Button variant="primary" disabled={busy || !sessionRoot || !projectsRoot} onClick={() => void saveFolders()}>{t.t('saveFolders')}</Button>}>
      {!model.api && <Callout tone="warning">{t.t('needDesktop')}</Callout>}
      <div className="settings-grid">
        <Panel title={t.t('preferences')} className="settings-card"><label><span>{t.t('language')}</span><Select value={locale} onChange={(event) => onLocale(event.target.value as AppLocale)}>{locales.map((code) => <option key={code} value={code}>{languageNames[code]}</option>)}</Select></label><Toggle checked={compact} label={t.t('compactList')} onClick={() => setCompact((value) => !value)} /><Toggle checked={reducedMotion} label={t.t('reduceMotion')} onClick={() => setReducedMotion((value) => !value)} /></Panel>
        <Panel title={t.t('foldersTitle')} className="settings-card"><FolderSetting label={t.t('indexFolder')} path={sessionRoot} busy={busy} onChoose={() => void model.chooseDirectory().then((path) => { if (path) setSessionRoot(path); })} /><FolderSetting label={t.t('transcriptFolder')} path={projectsRoot} busy={busy} onChoose={() => void model.chooseDirectory().then((path) => { if (path) setProjectsRoot(path); })} /><p className="settings-note">{t.t('localOnly')}</p></Panel>
        <Panel title={t.t('about')} className="settings-card settings-card--about"><p><strong>{t.t('caption')}</strong> · {t.t('offlineSample')}</p><p>{t.t('cloudBody')}</p><p>{info?.version ? `ClaudeSync ${info.version}` : 'ClaudeSync'}</p></Panel>
      </div>
    </PageSurface>;
  }

  function renderBackups() {
    return <PageSurface className="stage-surface stage-surface--backups" layout="centered" title={t.t('backupTitle')} description={t.t('backupBody')}>
      <div className="backups-page">{model.backups.length === 0 ? <p className="empty-state">{t.t('noBackups')}</p> : <ul className="backup-list">{model.backups.map((backup) => <li key={backup.id}><div><strong>{t.date(backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</strong><small>{t.t(backup.operation)}{backup.state !== 'verified' && ` · ${t.t('interrupted')}`}</small></div><Button variant="secondary" static disabled={busy} onClick={() => { void model.restore(backup.id); }}>{t.t('restore')}</Button></li>)}</ul>}<Button variant="secondary" static className="backups-open" onClick={() => void model.openBackups()}>{t.t('openBackups')}</Button></div>
    </PageSurface>;
  }

  function renderCloud() {
    return <PageSurface className="stage-surface stage-surface--cloud" title={t.t('cloudSessions')} description={t.t('cloudBody')}><CloudSessions refreshKey={cloudRefresh} onBusy={onCloudBusy} onRetry={() => setCloudRefresh((value) => value + 1)} /></PageSurface>;
  }

  function renderStage(): ReactNode {
    switch (stage) {
      case 'home': return renderHome();
      case 'scan': return renderScan();
      case 'results': return renderResults();
      case 'review': return renderReview();
      case 'progress': return renderProgress();
      case 'complete': return renderComplete();
      case 'cloud': return renderCloud();
      case 'backups': return renderBackups();
      case 'settings': return renderSettings();
    }
  }

  return <div className={`claudesync-app theme-${theme}`} data-stage={stage} data-game-ui-theme={theme} data-game-ui-style="outline">
    <Shell title="ClaudeSync" className="claudesync-shell" look="aura" platform={platform} density={compact ? 'dense' : 'comfortable'} reducedMotion={reducedMotion} layout="auto" sidebar={sidebar()} sidebarLabel={t.t('sources')} mobileNav={mobileNav()} windowBar={windowBar()} overlay={feedback}>
      {renderStage()}
    </Shell>
    {model.review && workspace && <OperationReview preview={model.review} choices={model.request?.titleSelections} contentChoices={model.request?.contentSelections} accounts={workspace.accounts} busy={busy} blocked={workspace.blockers.length > 0} onClose={model.closeReview} onApply={() => void applyOperation()}
      onChooseContent={(id, path) => { if (model.request) void model.preview({ ...model.request, contentSelections: { ...model.request.contentSelections, [id]: path } }); }}
      onChooseTitle={(id, scope) => { if (model.request) void model.preview({ ...model.request, titleSelections: { ...model.request.titleSelections, [id]: scope || 'skip' } }); }} />}
    {deleting && <DeleteConfirmation count={deleting.sessionIds.length} accountNames={deleting.names} state={deleting.state} group={deleting.group} busy={busy} onClose={() => setDeleting(undefined)}
      onDelete={() => { const request = deleting; setDeleting(undefined); void applyDeletion(request); }} />}
    {oldPreview && <OldCleanupDialog preview={oldPreview} busy={cleanupBusy} blocked={false} onClose={() => setOldPreview(undefined)} onConfirm={() => void confirmOldCopies()} />}
    {renameOpen && <Modal title={t.t('rename')} onClose={() => setRenameOpen(false)} busy={busy}
      actions={<><Button variant="secondary" static onClick={() => setRenameOpen(false)}>{t.t('back')}</Button><Button variant="primary" disabled={busy || !newTitle.trim()} onClick={() => { setRenameOpen(false); void action('rename', newTitle); }}>{t.t('previewRename')}</Button></>}>
      <label className="rename-field"><span>{t.t('titleInput')}</span><Input autoFocus value={newTitle} maxLength={500} onChange={(event) => setNewTitle(event.target.value)} /></label>
    </Modal>}
  </div>;
}

export function App() {
  const [locale, setLocale] = useState<AppLocale>(getInitialLocale);
  return <I18nProvider locale={locale}><AppContent locale={locale} onLocale={(value) => { setLocale(value); void rememberLocale({ get: () => localStorage.getItem('claudesync.locale') ?? undefined, set: (next) => localStorage.setItem('claudesync.locale', next) }, value); }} /></I18nProvider>;
}
