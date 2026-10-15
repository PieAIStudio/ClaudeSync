import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyDocumentLanguage, rememberLocale } from '@pieai/swimmer-i18n-kit/browser';
import { GameBadge, GameButton, GameCallout, GameInput } from '@pieai/swimmer-ui-kit';
import { I18nProvider, getInitialLocale, locales, useTranslation } from './i18n';
import type { AppLocale } from './i18n';
import type { OperationRequest } from '../shared/contracts';
import { AccountSidebar, DeleteConfirmation, Modal, OperationReview, Panel, SessionRows, accountName } from './components';
import { filterSessions, type SessionFilter } from './session-selection';
import { useWorkspace } from './useWorkspace';
import { deletionSelection, type DeleteSelection } from './deletion-selection';
import { CloudSessions } from './CloudSessions';

const languageNames: Record<AppLocale, string> = { 'zh-CN': '简体中文', en: 'English', ja: '日本語', es: 'Español', 'pt-BR': 'Português' };
const excludedKey = 'claudesync.excluded-account-ids';
function readExcluded(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(excludedKey) ?? localStorage.getItem('claudesync.excluded-account-scopes') ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((item): item is string => typeof item === 'string').map((item) => item.split('/')[0]!))] : [];
  } catch { return []; }
}

function AppContent({ locale, onLocale }: { locale: AppLocale; onLocale(locale: AppLocale): void }) {
  const t = useTranslation();
  const model = useWorkspace();
  const { info, workspace } = model;
  const [source, setSource] = useState<'local' | 'cloud'>('local');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const busy = model.busy || cloudBusy;
  const onCloudBusy = useCallback((value: boolean) => setCloudBusy(value), []);
  const [excluded, setExcluded] = useState(readExcluded);
  const [accountFilter, setAccountFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('active');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const [settings, setSettings] = useState(false);
  const [sessionRoot, setSessionRoot] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [deleting, setDeleting] = useState<(DeleteSelection & { revision: string; names: string[] })>();

  useEffect(() => applyDocumentLanguage(t.locale, t.direction), [t.locale, t.direction]);
  useEffect(() => { if (info) { setSessionRoot(info.suggestedSessionRoot); setProjectsRoot(info.suggestedProjectsRoot); } }, [info]);
  const included = useMemo(() => new Set(workspace?.accounts.filter((account) => !excluded.includes(account.id)).map((account) => account.id) ?? []), [workspace, excluded]);
  const visible = useMemo(() => filterSessions(workspace?.sessions ?? [], { included, accountId: accountFilter, filter, search, sort }), [workspace, included, accountFilter, filter, search, sort]);
  const eligibleToSelect = visible.filter((session) => session.manageable && session.presence.some((item) => included.has(item.accountId)));
  const hiddenSelected = [...selected].filter((id) => !visible.some((session) => session.id === id)).length;
  const deleteTargets = useMemo(() => deletionSelection(workspace?.sessions ?? [], selected, included, accountFilter), [workspace, selected, included, accountFilter]);
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => workspace?.sessions.some((session) => session.id === id && session.presence.some((item) => included.has(item.accountId))))));
  }, [workspace, included]);

  function includeAccount(id: string, value: boolean) {
    const next = value ? excluded.filter((item) => item !== id) : [...new Set([...excluded, id])];
    setExcluded(next); localStorage.setItem(excludedKey, JSON.stringify(next));
  }
  function toggle(id: string, value: boolean) {
    if (!eligibleToSelect.some((session) => session.id === id)) return;
    setSelected((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });
  }
  async function action(kind: OperationRequest['kind'], title?: string) {
    await model.preview({ kind, sessionIds: [...selected], accountIds: [...included], title });
  }
  const canAct = selected.size > 0 && included.size > 0 && !busy;
  const title = accountFilter === 'all' ? t.t('sessions') : accountName(workspace?.accounts.find((account) => account.id === accountFilter), t);
  const feedback = <div className="workspace-feedback" role="status" aria-live="polite">
    {model.error && <GameCallout heading={t.t('issue')} tone="danger">{model.error}</GameCallout>}
    {model.completed && <GameCallout tone="success">{t.t('complete')}</GameCallout>}
    {model.deleted && <GameCallout tone="success">{t.t('deleteComplete')}</GameCallout>}
  </div>;

  return <main className="claudesync-app" data-game-ui-theme="light" data-game-ui-style="outline">
    <header className="brand-header"><span className="brand-mark" aria-hidden="true">CS</span><div className="brand-title"><p>ClaudeSync</p><small>{t.t('caption')}</small></div>
      <div className="header-actions"><GameButton variant="ghost" disabled={busy} onClick={() => setSettings(!settings)}>{t.t('settings')}</GameButton>
        <label className="language-switcher"><span>{t.t('language')}</span><select value={locale} onChange={(event) => onLocale(event.target.value as AppLocale)}>{locales.map((code) => <option key={code} value={code}>{languageNames[code]}</option>)}</select></label>
      </div>
    </header>
    <section className="intro-row"><div><h1>{t.t('heroTitle')}</h1><p>{t.t('heroBody')}</p></div>
      <GameButton variant="secondary" disabled={busy || !info?.configured} onClick={() => { if (source === 'cloud') setCloudRefresh((value) => value + 1); else void model.refresh(); }}>{t.t(busy ? 'checking' : 'checkAgain')}</GameButton>
    </section>
    {!model.api ? <GameCallout tone="warning">{t.t('needDesktop')}</GameCallout> : !info?.configured || settings ? <Panel title={t.t('foldersTitle')} className="settings-panel">
      {[{ key: 'indexFolder' as const, value: sessionRoot, set: setSessionRoot }, { key: 'transcriptFolder' as const, value: projectsRoot, set: setProjectsRoot }].map((item) => <div className="folder-choice" key={item.key}>
        <div><strong>{t.t(item.key)}</strong><small>{item.value || '—'}</small></div><GameButton variant="secondary" disabled={busy} onClick={() => void model.chooseDirectory().then((path) => { if (path) item.set(path); })}>{t.t('chooseFolder')}</GameButton>
      </div>)}<div className="dialog-actions"><GameButton variant="primary" disabled={busy || !sessionRoot || !projectsRoot} onClick={() => void model.configure(sessionRoot, projectsRoot).then((success) => { if (success) setSettings(false); })}>{t.t('saveFolders')}</GameButton></div>
    </Panel> : <>
      <div className="workspace-status"><span>{t.t('localOnly')}</span>{workspace && source === 'local' && <GameBadge tone={workspace.blockers.length ? 'warning' : 'success'}>{t.t(workspace.blockers.length ? 'waiting' : 'ready')}</GameBadge>}</div>
      <div className="source-tabs" role="group" aria-label={t.t('sources')}><GameButton variant={source === 'local' ? 'primary' : 'secondary'} aria-pressed={source === 'local'} disabled={busy} onClick={() => { if (source !== 'local') { setSource('local'); void model.refresh(); } }}>{t.t('localSessions')}</GameButton>
        <GameButton variant={source === 'cloud' ? 'primary' : 'secondary'} aria-pressed={source === 'cloud'} disabled={busy} onClick={() => setSource('cloud')}>{t.t('cloudSessions')}</GameButton></div>
      {source === 'cloud' ? <CloudSessions refreshKey={cloudRefresh} onBusy={onCloudBusy} /> : <>
      {!workspace ? <p className="empty-state">{t.t('noCheck')}</p> : <div className="manager-layout">
        <AccountSidebar accounts={workspace.accounts} included={included} currentFilter={accountFilter} onInclude={includeAccount} onFilter={(id) => { setAccountFilter(id); setSelected(new Set()); }} busy={busy} identityState={workspace.identityState} />
        <section className="session-area" aria-label={t.t('sessions')}>
          <div className="session-heading"><h2>{title}</h2><span>{t.t('visibleCount', { shown: visible.length, total: workspace.sessions.filter((session) => session.presence.some((item) => accountFilter === 'all' ? included.has(item.accountId) : item.accountId === accountFilter)).length })}</span></div>
          <div className="session-filters"><GameInput type="search" aria-label={t.t('search')} placeholder={t.t('search')} value={search} onChange={(event) => setSearch(event.target.value)} />
            <select aria-label={t.t('filter')} value={filter} onChange={(event) => setFilter(event.target.value as SessionFilter)}>{(['active', 'all', 'archived', 'syncable', 'blocked', 'starred'] as const).map((key) => <option key={key} value={key}>{t.t(key)}</option>)}</select>
            <select aria-label={t.t('sort')} value={sort} onChange={(event) => setSort(event.target.value as 'updated' | 'title')}><option value="updated">{t.t('sortUpdated')}</option><option value="title">{t.t('sortTitle')}</option></select>
          </div>
          <div className="selection-tools"><label><input type="checkbox" checked={eligibleToSelect.length > 0 && eligibleToSelect.every((session) => selected.has(session.id))} disabled={busy || eligibleToSelect.length === 0}
            ref={(element) => { if (element) element.indeterminate = eligibleToSelect.some((session) => selected.has(session.id)) && !eligibleToSelect.every((session) => selected.has(session.id)); }}
            onChange={(event) => { const value = event.target.checked; setSelected((current) => { const next = new Set(current); for (const session of eligibleToSelect) { if (value) next.add(session.id); else next.delete(session.id); } return next; }); }} />{t.t('selectVisible')}</label>
            <GameButton variant="ghost" disabled={busy} onClick={() => setSelected(new Set(eligibleToSelect.filter((session) => session.presence.some((item) => included.has(item.accountId) && item.eligible)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 10).map((session) => session.id)))}>{t.t('selectTen')}</GameButton>
            {selected.size > 0 && <GameButton variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>{t.t('clearSelection')}</GameButton>}
          </div>
          <SessionRows sessions={visible} accounts={workspace.accounts} selected={selected} filterId={accountFilter} included={included} onToggle={toggle} busy={busy} />
        </section>
      </div>}
      {workspace && <section className="management-actions" aria-label={t.t('planned')}>
        <div className="selection-summary"><strong>{t.t('selectedCount', { count: selected.size })}</strong><span>{t.t('targets')}：{[...included].map((id) => accountName(workspace.accounts.find((account) => account.id === id), t)).join('、') || '—'}</span></div>
        {hiddenSelected > 0 && <p className="hidden-selection">{t.t('hiddenSelected', { count: hiddenSelected })}</p>}
        <div className="action-buttons"><GameButton variant="secondary" disabled={!canAct || included.size < 2} onClick={() => void action('sync')}>{t.t('sync')}</GameButton>
          <GameButton variant="primary" disabled={!canAct || included.size < 2} onClick={() => void action('keep')}>{t.t('keep')}</GameButton>
          <GameButton variant="secondary" disabled={!canAct} onClick={() => void action('archive')}>{t.t('archive')}</GameButton>
          <GameButton variant="ghost" disabled={!canAct} onClick={() => void action('unarchive')}>{t.t('unarchive')}</GameButton>
          <GameButton variant="danger" disabled={busy || !deleteTargets.sessionIds.length} onClick={() => setDeleting({ ...deleteTargets, revision: workspace.revision,
            names: deleteTargets.accountIds.map((id) => accountName(workspace.accounts.find((account) => account.id === id), t)) })}>{t.t('delete')}</GameButton>
          <details className="more-actions"><summary>{t.t('more')}</summary><div><GameButton variant="ghost" disabled={!canAct || selected.size !== 1} onClick={() => { setNewTitle(workspace.sessions.find((session) => selected.has(session.id))?.title || ''); setRenameOpen(true); }}>{t.t('rename')}</GameButton>
            <GameButton variant="ghost" disabled={!canAct} onClick={() => void action('star')}>{t.t('star')}</GameButton><GameButton variant="ghost" disabled={!canAct} onClick={() => void action('unstar')}>{t.t('unstar')}</GameButton>
          </div></details>
        </div><p className="action-tip">{selected.size ? t.t('keepTip') : t.t('needSelection')}</p>
        {deleteTargets.sessionIds.length > 0 && <p className="action-tip">{t.t('deleteScopeTip', { count: deleteTargets.sessionIds.length, accounts: deleteTargets.accountIds.map((id) => accountName(workspace.accounts.find((account) => account.id === id), t)).join('、') })}</p>}
        {feedback}
      </section>}
      </>}
    </>}
    {(!workspace || settings || !info?.configured) && feedback}
    <footer className="app-footer"><span>ClaudeSync {info?.version ?? '2.0'} · SwimmerUIKit</span>
      {workspace && source === 'local' && <GameButton variant="ghost" disabled={busy} onClick={() => void model.loadBackups().then((success) => { if (success) setBackupOpen(true); })}>{t.t('backupTitle')}</GameButton>}
      {workspace && source === 'local' && <span>{t.t('checkedAt', { time: t.date(workspace.checkedAt, { timeStyle: 'short' }) })}</span>}
    </footer>
    {model.review && workspace && <OperationReview preview={model.review} choices={model.request?.titleSelections} accounts={workspace.accounts} busy={busy} blocked={workspace.blockers.length > 0} onClose={model.closeReview} onApply={() => void model.apply()}
      onChooseTitle={(id, scope) => { if (model.request) void model.preview({ ...model.request, titleSelections: { ...model.request.titleSelections, [id]: scope || 'skip' } }); }} />}
    {deleting && <DeleteConfirmation count={deleting.sessionIds.length} accountNames={deleting.names} state={deleting.state} busy={busy} blocked={Boolean(workspace?.blockers.length)} onClose={() => setDeleting(undefined)}
      onDelete={() => { const request = deleting; setDeleting(undefined); void model.deleteSelected(request, request.revision).then((success) => { if (success) setSelected(new Set()); }); }} />}
    {renameOpen && <Modal title={t.t('rename')} onClose={() => setRenameOpen(false)} busy={busy}><label className="rename-field"><span>{t.t('titleInput')}</span><GameInput autoFocus value={newTitle} maxLength={500} onChange={(event) => setNewTitle(event.target.value)} /></label>
      <div className="dialog-actions"><GameButton variant="secondary" onClick={() => setRenameOpen(false)}>{t.t('back')}</GameButton><GameButton variant="primary" disabled={busy || !newTitle.trim()} onClick={() => { setRenameOpen(false); void action('rename', newTitle); }}>{t.t('previewRename')}</GameButton></div>
    </Modal>}
    {backupOpen && <Modal title={t.t('backupTitle')} onClose={() => setBackupOpen(false)} busy={busy}><p className="panel-intro">{t.t('backupBody')}</p>
      {model.backups.length === 0 ? <p>{t.t('noBackups')}</p> : <ul className="backup-list">{model.backups.map((backup) => <li key={backup.id}><div><strong>{t.date(backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</strong><small>{t.t(backup.operation)}{backup.state !== 'verified' && ` · ${t.t('interrupted')}`}</small></div>
        <GameButton variant="secondary" disabled={busy} onClick={() => { setBackupOpen(false); void model.restore(backup.id); }}>{t.t('restore')}</GameButton></li>)}</ul>}
      <div className="dialog-actions"><GameButton variant="secondary" onClick={() => setBackupOpen(false)}>{t.t('back')}</GameButton><GameButton variant="ghost" onClick={() => void model.openBackups()}>{t.t('openBackups')}</GameButton></div>
    </Modal>}
  </main>;
}

export function App() {
  const [locale, setLocale] = useState<AppLocale>(getInitialLocale);
  return <I18nProvider locale={locale}><AppContent locale={locale} onLocale={(value) => { setLocale(value); void rememberLocale({ get: () => localStorage.getItem('claudesync.locale') ?? undefined, set: (next) => localStorage.setItem('claudesync.locale', next) }, value); }} /></I18nProvider>;
}
