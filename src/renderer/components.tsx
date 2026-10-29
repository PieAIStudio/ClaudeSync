import { useEffect, useRef, type ReactNode } from 'react';
import { Badge, Button, Callout, Panel as UIKitPanel } from '@pieai/swimmer-ui-kit';
import { useTranslation } from './i18n';
import type { TranslationKey } from './i18n';
import type { AccountView, DesktopIdentityState, OperationPreview, SessionGroup, SessionView } from '../shared/contracts';
import type { DeleteState } from './deletion-selection';
import { ProgressReview } from './ProgressReview';
import { TermTip } from './TermTip';
import { messageText } from './errors';
import { parseMessage } from '../error-copy';

export const groupLabels: Record<SessionGroup, TranslationKey> = {
  visible: 'visibleGroup', archived: 'archived', scheduled: 'scheduledGroup',
  oldOrganization: 'oldOrganizationGroup', deleted: 'deletedGroup', unverified: 'unverifiedGroup',
};

export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <UIKitPanel className={className}><h2 className="panel-heading">{title}</h2>{children}</UIKitPanel>;
}

export function SkippedEntriesNotice({ paths }: { paths: string[] }) {
  const t = useTranslation();
  if (!paths.length) return null;
  return <div className="skipped-entries" role="status"><Callout heading={t.t('attention')} tone="warning">
    <ul>{paths.map((path) => <li key={path}>{t.t('skippedPath', { path })}</li>)}</ul>
  </Callout></div>;
}

/** A sheet with a fixed head and footer; only the body scrolls, so the actions and their warning never cover content. */
export function Modal({ title, lead, actions, children, onClose, busy = false }: {
  title: string; lead?: ReactNode; actions: ReactNode; children?: ReactNode; onClose(): void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current; element?.showModal();
    // Open on the sheet itself, not its first toggle, so no focus ring shows before the user moves; text fields keep their focus.
    if (!(document.activeElement instanceof HTMLInputElement)) element?.focus();
    return () => element?.close();
  }, []);
  return <dialog className="review-dialog" ref={dialog} tabIndex={-1} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-head"><h2>{title}</h2>{lead && <p>{lead}</p>}</header>
    {children && <div className="dialog-body">{children}</div>}
    <footer className="dialog-actions">{actions}</footer>
  </dialog>;
}

/** One folder per row: its name first, the full path under it, and the chooser beside it. */
export function FolderSetting({ label, path, busy, onChoose }: { label: string; path: string; busy: boolean; onChoose(): void }) {
  const t = useTranslation();
  const name = path.split(/[\\/]/).filter(Boolean).at(-1);
  return <div className="settings-path">
    <span>{label}</span>
    <div className="settings-path-value">{path ? <><strong>{name ?? path}</strong><code title={path}>{path}</code></> : <strong>{t.t('notSet')}</strong>}</div>
    <Button variant="secondary" static disabled={busy} onClick={onChoose}>{t.t('chooseFolder')}</Button>
  </div>;
}

export function accountName(account: AccountView | undefined, t: ReturnType<typeof useTranslation>): string {
  return account?.email ?? t.t('unknown', { id: account?.id.slice(0, 8) ?? '?' });
}

export function DeleteConfirmation({ count, accountNames, state, group, source = 'local', busy, blocked = false, onClose, onDelete }: {
  count: number; accountNames: string[]; state: DeleteState; group?: SessionGroup; source?: 'local' | 'cloud';
  busy: boolean; blocked?: boolean; onClose(): void; onDelete(): void;
}) {
  const t = useTranslation();
  return <Modal title={t.t(count === 1 ? 'deleteConfirmTitleOne' : 'deleteConfirmTitle', { count })} lead={t.t(source === 'local' ? 'deleteLocalScope' : 'deleteCloudScope')} onClose={onClose} busy={busy}
    actions={<>{blocked && <p className="operation-warning">{t.t('waiting')}</p>}
      <Button variant="secondary" autoFocus disabled={busy} onClick={onClose}>{t.t('cancel')}</Button>
      <Button variant="danger" disabled={busy || blocked || count === 0} onClick={onDelete}>{t.t(busy ? 'deleting' : 'confirmDelete')}</Button></>}>
    <ReviewFacts group={group} accountNames={accountNames} />
    <p className="operation-warning">{t.t('deleteNoRecovery')}</p>
    {source === 'local' && <p className="panel-intro">{t.t('scopedWriteCheck')}</p>}
    <p className="panel-intro">{t.t(source === 'local' && group === 'oldOrganization' ? 'oldDeleteAdvice' : state === 'archived' ? 'deleteArchivedAdvice' : state === 'mixed' ? 'deleteMixedAdvice' : 'deleteActiveAdvice')}</p>
  </Modal>;
}

/** The scope of a write in one glance: action, group and every affected account. */
function ReviewFacts({ action, group, accountNames }: { action?: string; group?: SessionGroup; accountNames: string[] }) {
  const t = useTranslation();
  return <dl className="review-facts">
    {action && <><dt>{t.t('reviewAction')}</dt><dd>{action}</dd></>}
    {group && <><dt>{t.t('reviewGroup')}</dt><dd>{t.t(groupLabels[group])}</dd></>}
    <dt>{t.t('targets')}</dt><dd className="review-accounts">{accountNames.map((name) => <span key={name}>{name}</span>)}</dd>
  </dl>;
}

const reasonKeys = {
  deleted: new Set(['statusDeletedHistoryNotCopied', 'statusDeletedHistoryPreventsResurrection', 'statusDeletedEntryPreventsResurrection']),
  archived: new Set(['statusArchivedNotCopied', 'statusTargetArchived']),
  project: new Set(['statusWorkingDirectoryMissing', 'statusWorkingDirectoryNotFound']),
  transcript: new Set(['statusTranscriptMissing', 'statusTranscriptDuplicate']),
  unsupported: new Set(['statusRemoteNotCopied', 'statusScheduledNotCopied']),
} as const;

function hasReason(reason: string, keys: ReadonlySet<string>, legacy: string): boolean {
  return keys.has(parseMessage(reason)?.key ?? '') || reason.includes(legacy);
}

function reasonText(reason: string, t: ReturnType<typeof useTranslation>): string {
  if (hasReason(reason, reasonKeys.deleted, '删除标记') || reason.includes('曾被删除')) return t.t('deletedReason');
  if (hasReason(reason, reasonKeys.archived, '归档')) return t.t('archivedReason');
  if (hasReason(reason, reasonKeys.project, '工作目录')) return t.t('missingProject');
  if (hasReason(reason, reasonKeys.transcript, '缺少会话正文')) return t.t('missingTranscript');
  if (hasReason(reason, reasonKeys.unsupported, '远程') || reason.includes('定时')) return t.t('unsupported');
  return messageText(reason, t.locale);
}

export function AccountSidebar({ accounts, included, currentFilter, onInclude, onFilter, busy, identityState }: {
  accounts: AccountView[]; included: Set<string>; currentFilter: string; onInclude(id: string, value: boolean): void; onFilter(id: string): void; busy: boolean; identityState?: DesktopIdentityState;
}) {
  const t = useTranslation();
  return <aside className="account-sidebar">
    <div className="sidebar-heading"><h2>{t.t('accounts')}</h2><span>{accounts.length}</span></div>
    <div className="sidebar-scope"><span>{t.t('sessions')}</span><TermTip term="code" /></div>
    <Button variant="ghost" className={`all-accounts ${currentFilter === 'all' ? 'is-active' : ''}`} onClick={() => onFilter('all')}>{t.t('allAccounts')}</Button>
    <ul className="account-list">{accounts.map((account) => <li key={account.id} className={`${currentFilter === account.id ? 'is-active' : ''} ${included.has(account.id) ? '' : 'is-excluded'}`}>
      <input type="checkbox" aria-label={`${t.t('includeAccount')} ${accountName(account, t)}`} checked={included.has(account.id)} disabled={busy}
        onChange={(event) => onInclude(account.id, event.target.checked)} />
      <div className="account-info">
        <div className="account-heading"><button className="account-open" onClick={() => onFilter(account.id)}><strong>{accountName(account, t)}</strong></button>
          {!account.email && <TermTip term="unknownEmail" />}</div>
        <div className="count-with-tip"><span className="account-main-count">{account.visible === null || !account.organizationVerified ? t.t('unverifiedCount') : account.visible === 1 ? t.t('desktopCountOne') : t.t('desktopCount', { count: account.visible })}</span>
          <TermTip term={account.visible === null || !account.organizationVerified ? 'unverified' : 'visible'} /></div>
        <div className="account-secondary-counts">{([
          ['archived', 'archivedCountLabel', account.archived], ['scheduled', 'scheduledCountLabel', account.scheduled],
          ['oldOrganization', 'oldCountLabel', account.oldCopies],
        ] as const).map(([term, label, count]) => <div className="count-with-tip" key={term}><span>{t.t(label)} {count}</span><TermTip term={term} /></div>)}</div>
        {account.current && <Badge tone="neutral">{t.t('current')}</Badge>}
      </div>
    </li>)}</ul>
    {identityState && identityState !== 'verified' && <p className="identity-tip" role="status">{t.t(identityState === 'changed' ? 'identityChanged' : identityState === 'unsupported' ? 'identityUnsupported' : 'identityUnavailable')}</p>}
  </aside>;
}

export function SessionRows({ sessions, accounts, selected, filterId, included, onToggle, busy, idPrefix = 'session' }: {
  sessions: SessionView[]; accounts: AccountView[]; selected: Set<string>; filterId: string; included: Set<string>; onToggle(id: string, value: boolean): void; busy: boolean; idPrefix?: string;
}) {
  const t = useTranslation();
  if (!sessions.length) return <p className="empty-state">{t.t('noSessions')}</p>;
  return <ul className="session-list">{sessions.map((session) => {
    const presence = session.presence.filter((item) => filterId === 'all' ? included.has(item.accountId) : item.accountId === filterId);
    const active = presence.some((item) => item.active);
    const eligible = presence.some((item) => item.eligible);
    const reasons = [...new Set(presence.flatMap((item) => item.reasons))];
    const selectedRestore = session.manageable && reasons.some((reason) => hasReason(reason, reasonKeys.deleted, '删除标记') || reason.includes('曾被删除'));
    const projectName = session.project.split(/[\\/]/u).filter(Boolean).at(-1) || '—';
    const projectMissing = presence.some((item) => item.reasons.some((reason) => hasReason(reason, reasonKeys.project, '工作目录')))
      || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(projectName);
    const status = selectedRestore ? 'reviewToRestore' : !active ? 'archived' : eligible ? 'syncable' : 'blocked';
    return <li key={session.id} className={`session-row ${selected.has(session.id) ? 'is-selected' : ''}`}>
      <input id={`${idPrefix}-${session.id}`} type="checkbox" aria-label={session.title || t.t('untitled')} checked={selected.has(session.id)} disabled={busy || !session.manageable || !session.presence.some((item) => included.has(item.accountId))}
        onChange={(event) => onToggle(session.id, event.target.checked)} />
      <div className="session-copy">
        <label className="session-title" htmlFor={`${idPrefix}-${session.id}`}>
          {session.starred && <span className="star-mark" aria-label={t.t('starred')}>★</span>}{session.title || t.t('untitled')}
        </label>
        <div className="session-meta"><span title={projectMissing ? t.t('projectMissing') : session.project}>{projectMissing ? t.t('projectMissing') : projectName}</span>
          {session.updatedAt && <time dateTime={session.updatedAt}>{t.date(session.updatedAt, { dateStyle: 'medium' })}</time>}
        </div>
      </div>
      <span className={`session-status session-status--${status}`}>{t.t(status)}</span>
      <details className="session-details"><summary><span>{t.t('rowDetails')}</span><span aria-hidden="true">›</span></summary><div>
        {reasons.length > 0 && <p className="session-detail-reason">{reasons.map((reason) => <span key={reason}>{reasonText(reason, t)}</span>)}</p>}
        <p>{t.t('project')}: {session.project || '—'}</p><p>ID: {session.id}</p>
        {!session.manageable && <p>{t.t('unsupported')}</p>}
        {session.presence.map((item) => <div className="presence-detail" key={item.accountId}>
          <strong>{accountName(accounts.find((account) => account.id === item.accountId), t)}</strong>
          <span>{t.t(item.active ? 'active' : 'archived')} · {item.copies === 1 ? t.t('copyOne') : t.t('copies', { count: item.copies })}</span>
          <p>{t.t('titleVariants')}: {item.titles.filter(Boolean).join(' / ') || t.t('untitled')}</p>
          {item.reasons.map((reason) => <p key={reason}>{reasonText(reason, t)}</p>)}
        </div>)}
      </div></details>
    </li>;
  })}</ul>;
}

export function CollapsedSessionGroup({ group, sessions, accounts, selected, filterId, included, onToggle, onCollapse, busy }: {
  group: Exclude<SessionGroup, 'visible'>; sessions: SessionView[]; accounts: AccountView[]; selected: Set<string>;
  filterId: string; included: Set<string>; onToggle(id: string, value: boolean): void; onCollapse(): void; busy: boolean; markerCount?: number;
}) {
  const t = useTranslation();
  return <div className="supplementary-section">
    <details className="supplementary-group" data-group={group} onToggle={(event) => { if (!event.currentTarget.open) onCollapse(); }}>
      <summary>{t.t(groupLabels[group])} <span>{sessions.length}</span></summary>
      <SessionRows sessions={sessions} accounts={accounts} selected={selected} filterId={filterId} included={included} onToggle={onToggle} busy={busy} idPrefix={`group-${group}`} />
    </details>
    <span className="group-tip"><TermTip term={group} /></span>
  </div>;
}

export function OperationReview({ preview, accounts, choices, contentChoices, busy, blocked, onClose, onApply, onChooseTitle, onChooseContent }: {
  preview: OperationPreview; accounts: AccountView[]; choices?: Record<string, string>; busy: boolean; blocked: boolean; onClose(): void; onApply(): void; onChooseTitle(id: string, scope: string): void;
  contentChoices?: Record<string, string>; onChooseContent?(id: string, path: string): void;
}) {
  const t = useTranslation();
  const actionKeys: Record<string, TranslationKey> = { update: 'update', add: 'add', title: 'title', archive: 'archive', unarchive: 'unarchive', delete: 'delete', star: 'star', unstar: 'unstar', restore: preview.kind === 'sync' ? 'clearDeletionNote' : 'restore' };
  const unresolved = preview.progressConflicts?.some((item) => !item.resolved);
  return <Modal title={t.t('previewTitle')} lead={t.t('previewBody')} onClose={onClose} busy={busy}
    actions={<>{blocked && <p className="operation-warning">{t.t('waiting')}</p>}
      <Button variant="secondary" autoFocus disabled={busy} onClick={onClose}>{t.t('back')}</Button>
      <Button variant={preview.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || blocked || preview.fileCount === 0 || unresolved} onClick={onApply}>{t.t(busy ? 'applying' : 'confirm')}</Button></>}>
    <ReviewFacts action={t.t(preview.kind)} group={preview.group} accountNames={preview.accountIds.map((id) => accountName(accounts.find((account) => account.id === id), t))} />
    {preview.kind === 'keep' && <p className="operation-warning">{t.t('keepWarning')}</p>}
    {preview.kind === 'sync' && <p className="panel-intro">{t.t('selectedSyncHelp')}</p>}
    <ProgressReview preview={preview} accounts={accounts} choices={contentChoices} busy={busy} onChoose={onChooseContent} />
    {preview.conflicts.length > 0 && <section className="title-conflicts"><h3>{t.t('conflicts')}</h3>{preview.conflicts.map((conflict) => <label key={conflict.id}>
      <span>{t.t('chooseTitle')}</span><select value={choices?.[conflict.id] === 'skip' ? '' : choices?.[conflict.id] ?? ''} onChange={(event) => onChooseTitle(conflict.id, event.target.value)} disabled={busy}>
        <option value="">{t.t('leaveTitle')}</option>{conflict.options.map((option) => <option key={option.scope} value={option.scope}>
          {accountName(accounts.find((account) => account.id === option.accountId), t)}: {option.title || t.t('untitled')}
        </option>)}
      </select>
    </label>)}</section>}
    {preview.fileCount === 0 ? <p>{t.t(unresolved ? 'chooseVersion' : 'noChanges')}</p> : <section className="review-changes">
      <h3>{t.t('planned')}</h3><ul>{preview.changes.map((item, index) => <li key={`${item.accountId}-${item.sessionId}-${item.action}-${index}`}>
        <span><strong>{item.title || t.t('untitled')}</strong><small>{accountName(accounts.find((account) => account.id === item.accountId), t)}</small></span>
        <Badge tone={item.action === 'delete' ? 'warning' : 'neutral'}>{t.t(actionKeys[item.action]!)}</Badge>
      </li>)}</ul>
    </section>}
    {preview.selected.length > 0 && <details className="review-more" open={preview.kind === 'keep'}><summary>{preview.selected.length === 1 ? t.t('selectedCountOne') : t.t('selectedCount', { count: preview.selected.length })}</summary>
      <ul>{preview.selected.map((session) => <li key={session.id}><strong>{session.title || t.t('untitled')}</strong><small>{session.id.slice(0, 8)}</small></li>)}</ul>
    </details>}
    {preview.skipped.length > 0 && <details className="review-more"><summary>{t.t('skipped')} ({preview.skipped.length})</summary>{preview.skipped.map((item, i) => <p key={i}><strong>{item.title || t.t('untitled')}</strong>: {reasonText(item.reason, t)}</p>)}</details>}
  </Modal>;
}
