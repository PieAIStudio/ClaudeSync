import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Callout, HelpTip, Input } from '@pieai/swimmer-ui-kit';
import type { CloudSessionView, CloudWorkspaceView } from '../shared/contracts';
import { DeleteConfirmation } from './components';
import { useTranslation } from './i18n';
import { errorMessage, messageText } from './errors';
import { TermTip } from './TermTip';

type CloudTranslation = ReturnType<typeof useTranslation>;
type CloudBusyHandler = (value: boolean) => void;

function useCloudSessionState(refreshKey: number, onBusy: CloudBusyHandler, t: CloudTranslation) {
  const api = window.claudeSync;
  const [workspace, setWorkspace] = useState<CloudWorkspaceView>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'archived' | 'active' | 'all'>('archived');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [confirmation, setConfirmation] = useState<{ workspace: CloudWorkspaceView; rows: CloudSessionView[] }>();
  const running = useRef(false);
  const load = useRef<{ key: number; promise: Promise<CloudWorkspaceView> } | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (!api) { setError(t.t('needDesktop')); return; }
    running.current = true; setBusy(true); onBusy(true); setError(''); setDone(''); setWorkspace(undefined); setSelected(new Set());
    if (!load.current || load.current.key !== refreshKey) load.current = { key: refreshKey, promise: api.cloudSessions() };
    void load.current.promise.then((view) => { if (active) setWorkspace(view); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason, t.locale)); })
      .finally(() => { running.current = false; if (active) { setBusy(false); onBusy(false); } });
    return () => { active = false; onBusy(false); };
  }, [refreshKey, onBusy]);

  const visible = workspace?.sessions.filter((session) => (filter === 'all' || (filter === 'archived' ? session.status === 'archived' : session.status !== 'archived'))
    && (!search.trim() || `${session.title} ${session.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) ?? [];
  const selectable = visible.filter((session) => session.deletable);
  const hidden = [...selected].filter((id) => !visible.some((session) => session.id === id)).length;
  const chosen = workspace?.sessions.filter((session) => selected.has(session.id) && session.deletable) ?? [];

  async function remove() {
    if (!api || !confirmation || running.current) return;
    const current = confirmation;
    setConfirmation(undefined); running.current = true; setBusy(true); onBusy(true); setError(''); setDone('');
    try {
      const result = await api.deleteCloudSessions(current.rows.map((row) => row.id), current.workspace.revision);
      setWorkspace(result.workspace); setSelected(new Set());
      if (result.deleted > 0) setDone(result.requested === 1 ? t.t('cloudDeletedCountOne') : t.t('cloudDeletedCount', { deleted: result.deleted, requested: result.requested }));
      if (result.issue) setError(messageText(result.issue, t.locale));
    } catch (reason) {
      setError(errorMessage(reason, t.locale)); setWorkspace(undefined); setSelected(new Set());
    } finally { running.current = false; setBusy(false); onBusy(false); }
  }

  return { api, workspace, selected, search, setSearch, filter, setFilter, busy, error, done, confirmation,
    visible, selectable, hidden, chosen, setSelected, setConfirmation, remove };
}

export function CloudSessions({ refreshKey, onBusy, onRetry }: { refreshKey: number; onBusy(value: boolean): void; onRetry?(): void }) {
  const t = useTranslation();
  const state = useCloudSessionState(refreshKey, onBusy, t);
  const { workspace, selected, search, setSearch, filter, setFilter, busy, error, done, confirmation,
    visible, selectable, hidden, chosen, setSelected, setConfirmation, remove } = state;
  return <section className="cloud-manager" aria-label={t.t('cloudSessions')}>
    <div className="heading-with-tip"><h2>{t.t('cloudSessions')}</h2><TermTip term="code" /><HelpTip label={t.t('helpFor', { term: t.t('cloudSessions') })}>{t.t('cloudBody')}</HelpTip></div>
    {busy && !workspace && <p role="status">{t.t('checking')}</p>}
    {workspace && <>
      <div className="cloud-heading"><div><h2>{workspace.email}</h2><p>{t.t('cloudCounts', { active: workspace.sessions.filter((row) => row.status !== 'archived').length, archived: workspace.sessions.filter((row) => row.status === 'archived').length })}</p></div><Badge tone="neutral">{t.t('current')}</Badge></div>
      {workspace.limitReached && <Callout tone="warning">{t.t('cloudLimit')}</Callout>}
      <div className="session-filters cloud-filters"><Input type="search" aria-label={t.t('search')} placeholder={t.t('cloudSearch')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={t.t('filter')} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>{(['archived', 'active', 'all'] as const).map((key) => <option key={key} value={key}>{t.t(key)}</option>)}</select></div>
      <div className="selection-tools"><label><input type="checkbox" disabled={busy || !selectable.length} checked={selectable.length > 0 && selectable.every((row) => selected.has(row.id))}
        ref={(element) => { if (element) element.indeterminate = selectable.some((row) => selected.has(row.id)) && !selectable.every((row) => selected.has(row.id)); }}
        onChange={(event) => { const checked = event.target.checked; setSelected((current) => { const next = new Set(current); for (const row of selectable) { if (checked) next.add(row.id); else next.delete(row.id); } return next; }); }} />{t.t('selectVisible')}</label>
        {selected.size > 0 && <Button variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>{t.t('clearSelection')}</Button>}
        <span>{t.t('visibleCount', { shown: visible.length, total: workspace.sessions.length })}</span></div>
      {!visible.length ? <p className="empty-state">{t.t('noSessions')}</p> : <ul className="session-list cloud-list">{visible.map((row) => <li key={row.id} className={`session-row ${selected.has(row.id) ? 'is-selected' : ''}`}>
        <input id={`cloud-${row.id}`} type="checkbox" aria-label={row.title || t.t('untitled')} disabled={busy || !row.deletable} checked={selected.has(row.id)} onChange={(event) => { const checked = event.target.checked;
          setSelected((current) => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; }); }} />
        <div className="session-copy"><label className="session-title" htmlFor={`cloud-${row.id}`}>{row.title || t.t('untitled')}</label>
          <div className="session-meta"><span>{t.t('cloudSessions')}</span>{row.updatedAt && <time dateTime={row.updatedAt}>{t.date(row.updatedAt, { dateStyle: 'medium' })}</time>}</div>
          {!row.deletable && <p className="session-reason">{t.t(row.blockedReason === 'running' ? 'cloudRunning' : 'cloudUnsupported')}</p>}
        </div><Badge tone="neutral">{t.t(row.status === 'archived' ? 'archived' : 'active')}</Badge>
      </li>)}</ul>}
      <p className="action-tip">{t.t('checkedAt', { time: t.date(workspace.checkedAt, { timeStyle: 'short' }) })}</p>
      <section className="management-actions"><div className="selection-summary"><strong>{chosen.length === 1 ? t.t('selectedCountOne') : t.t('selectedCount', { count: chosen.length })}</strong><span>{workspace.email} · {t.t('cloudSessions')}</span></div>
        {hidden > 0 && <p className="hidden-selection">{t.t('hiddenSelected', { count: hidden })}</p>}
        <div className="action-buttons"><Button variant="danger" disabled={busy || !chosen.length} onClick={() => setConfirmation({ workspace, rows: chosen })}>{t.t('delete')}</Button></div>
      </section>
    </>}
    <div className="workspace-feedback" role="status" aria-live="polite">{error && <Callout heading={t.t('issue')} tone="danger">{error}</Callout>}{done && <Callout tone="success">{done}</Callout>}</div>
    {error && !workspace && !busy && onRetry && <Button variant="secondary" static className="cloud-retry" onClick={onRetry}>{t.t('checkAgain')}</Button>}
    {confirmation && <DeleteConfirmation count={confirmation.rows.length} accountNames={[confirmation.workspace.email]} source="cloud"
      state={confirmation.rows.every((row) => row.status === 'archived') ? 'archived' : confirmation.rows.every((row) => row.status !== 'archived') ? 'active' : 'mixed'} busy={busy} onClose={() => setConfirmation(undefined)} onDelete={() => void remove()} />}
  </section>;
}
