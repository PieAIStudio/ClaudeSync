import { Button, Callout, Icon, Select, Toggle } from '@pieai/swimmer-ui-kit';
import { StageFrame } from './StageFrame';
import { useTranslation, locales } from './i18n';
import type { TranslationKey } from './i18n';
import type { AppController } from './app-controller';
import { languageNames } from './app-types';
import { accountName, FolderSetting, Panel } from './components';
import { PageArt, RelayArt } from './visuals';
import { changedSessionIds, resultOutcome, type ResultOutcome } from './result-copy';

export function CompleteStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const failed = Boolean(controller.error);
  const verified = !failed && controller.result?.verified === true;
  const interruption = verified ? undefined : controller.interruption;
  const partial = Boolean(interruption && interruption.filesChanged > 0);
  const receiptIcon = verified ? 'check' : 'alert';
  const preview = controller.lastPreview;
  const operation = preview?.kind;
  const outcome = resultOutcome(controller.deleted ? 'delete' : operation, controller.result);
  const resultKeys: Record<ResultOutcome, TranslationKey> = {
    trash: 'resultTrash', backup: 'resultBackup', trashAndBackup: 'resultTrashAndBackup', noBackup: 'resultNoBackup', deleteNoTranscript: 'resultDeleteNoTranscript',
  };
  const trashCount = controller.result?.trashCount ?? 0;
  const summaryKey: TranslationKey = outcome === 'trash' && trashCount === 1 ? 'resultTrashOne'
    : outcome === 'trashAndBackup' && trashCount === 1 ? 'resultTrashAndBackupOne' : resultKeys[outcome];
  const summary = t.t(summaryKey, outcome === 'trash' || outcome === 'trashAndBackup' ? { count: trashCount } : {});
  const changes = preview?.changes ?? [];
  const changedIds = changedSessionIds(preview);
  const count = changedIds.length;
  const title = partial ? t.t(operation === 'sync' ? 'syncInterrupted' : 'operationInterrupted')
    : !verified ? t.t(operation === 'sync' && controller.errorKey === 'errorWorkspaceChanged' ? 'sessionsChangedBeforeSync' : 'issue')
    : operation === 'sync' ? t.t(count === 1 ? 'syncCompleteCountOne' : 'syncCompleteCount', { count })
    : operation === 'archive' ? t.t(count === 1 ? 'archiveCompleteCountOne' : 'archiveCompleteCount', { count })
    : operation === 'unarchive' ? t.t(count === 1 ? 'unarchiveCompleteCountOne' : 'unarchiveCompleteCount', { count })
    : operation === 'restore' && preview?.backup ? t.t('restoreComplete', { date: t.date(preview.backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })
    : t.t('operationCompleteTitle');
  const accountLabel = (id: string) => {
    const account = controller.lastAccounts.find((item) => item.id === id);
    const fallback = t.t('unknown', { id: id.slice(0, 8) });
    const label = account ? accountName(account, t) : fallback;
    return label === fallback ? label.replace(/ /gu, '\u00a0') : label;
  };
  const accountSeparator = t.locale === 'zh-CN' ? '、' : ', ';
  const names = (ids: string[]) => [...new Set(ids)].map(accountLabel).join(accountSeparator);
  const targetText = (items: typeof changes) => {
    if (!verified) return t.t('receiptPlannedFor', { accounts: names(items.map((item) => item.accountId)) });
    if (operation === 'sync') {
      const added = items.filter((item) => item.action === 'add').map((item) => item.accountId);
      const updated = items.filter((item) => item.action !== 'add').map((item) => item.accountId);
      return [added.length ? t.t('receiptAddedTo', { accounts: names(added) }) : '',
        updated.length ? t.t('receiptUpdatedIn', { accounts: names(updated) }) : ''].filter(Boolean).join(t.locale === 'zh-CN' ? '；' : '; ');
    }
    const key = operation === 'archive' ? 'receiptArchivedIn' : operation === 'unarchive' ? 'receiptUnarchivedIn'
      : operation === 'restore' ? 'receiptRestoredIn' : 'receiptUpdatedIn';
    return t.t(key, { accounts: names(items.map((item) => item.accountId)) });
  };
  const completedItems = changedIds.map((id) => {
    const items = changes.filter((item) => item.sessionId === id);
    return { id, title: items[0]?.title || preview?.selected.find((item) => item.id === id)?.title || t.t('untitled'), targets: targetText(items) };
  });
  const plannedAccountIds = new Set(changes.map((item) => item.accountId));
  const partialAccountIds = [...new Set([...(preview?.accountIds ?? []), ...plannedAccountIds,
    ...(interruption?.changedAccountIds ?? []), ...(interruption?.pendingAccountIds ?? [])])];
  return <StageFrame className="stage-surface stage-surface--complete" data-verified={verified} data-partial={partial} title={title}><div className="complete-layout"><aside className="complete-art"><RelayArt state={verified ? 'complete' : 'attention'} celebrate={verified && controller.celebrate} /></aside><section className="complete-card">
    <header><h1>{title}</h1></header>
    <div className="receipt-body">
      {partial ? <>
        <p className="partial-summary" role="alert">{t.t('partialResultBody')}</p>
        {controller.error && controller.error !== interruption!.explanation && <Callout tone="danger">{controller.error}</Callout>}
        <ul className="completion-list partial-account-list">{partialAccountIds.map((id) => {
          const recorded = interruption!.changedAccountIds.includes(id);
          const planned = plannedAccountIds.has(id) || interruption!.pendingAccountIds.includes(id);
          const outcome = recorded ? 'recorded' : planned ? 'unconfirmed' : 'unplanned';
          return <li key={id} data-outcome={outcome}>{outcome !== 'unplanned' && <Icon icon="alert" />}<strong>{accountLabel(id)}</strong><span>{t.t(recorded ? 'recordedNotVerified' : planned ? 'needsChecking' : 'receiptNoChangesPlanned')}</span></li>;
        })}</ul>
        <details className="review-more receipt-error-details"><summary><span>{t.t('interruptionDetails')}</span><Icon icon="chevron-down" size="sm" /></summary>
          <p>{interruption!.explanation}</p>
          <ul>{completedItems.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.targets}</span></li>)}</ul>
        </details>
      </> : <>
        {failed && <Callout tone="danger">{controller.error}</Callout>}
        <p className="complete-proof">{t.t(verified ? 'resultVerified' : 'resultUnverified')}</p>
        <ul className="completion-list">{completedItems.map((item) => <li key={item.id}><Icon icon={receiptIcon} /><strong>{item.title}</strong><span>{item.targets}</span></li>)}</ul>
        {verified && <p className="receipt-recovery">{summary}</p>}
      </>}
    </div>
    <footer><Button className={verified ? 'receipt-primary' : 'receipt-back'} variant={verified ? 'primary' : 'ghost'} static disabled={controller.busy} onClick={() => { controller.setCelebrate(false); controller.setStage(controller.workspace ? 'review' : 'home'); }}>{t.t('returnToChats')}</Button>
      {!verified && <Button className="receipt-primary" variant="primary" static pending={controller.busy} disabled={controller.busy} onClick={() => void controller.refreshReview()}>{t.t(preview ? 'refreshReview' : 'refreshSessions')}</Button>}
    </footer>
  </section></div></StageFrame>;
}

export function SettingsStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--settings" layout="centered" title={t.t('settings')} header={<PageArt kind="settings" />} primaryAction={<Button variant="primary" disabled={controller.busy || !controller.sessionRoot || !controller.projectsRoot} onClick={() => void controller.saveFolders()}>{t.t('saveFolders')}</Button>}>
    {!controller.api && <Callout tone="warning">{t.t('needDesktop')}</Callout>}<div className="settings-grid">
      <Panel title={t.t('preferences')} className="settings-card"><label><span>{t.t('language')}</span><Select value={controller.locale} onChange={(event) => controller.onLocale(event.target.value as typeof controller.locale)}>{locales.map((code) => <option key={code} value={code}>{languageNames[code]}</option>)}</Select></label><Toggle checked={controller.compact} label={t.t('compactList')} onClick={() => controller.setCompact((value) => !value)} /><Toggle checked={controller.reducedMotion} label={t.t('reduceMotion')} onClick={() => controller.setReducedMotion((value) => !value)} /></Panel>
      <Panel title={t.t('foldersTitle')} className="settings-card"><FolderSetting label={t.t('indexFolder')} path={controller.sessionRoot} busy={controller.busy} onChoose={() => void controller.model.chooseDirectory().then((path) => { if (path) controller.setSessionRoot(path); })} /><FolderSetting label={t.t('transcriptFolder')} path={controller.projectsRoot} busy={controller.busy} onChoose={() => void controller.model.chooseDirectory().then((path) => { if (path) controller.setProjectsRoot(path); })} /><p className="settings-note">{t.t('localOnly')}</p></Panel>
      <Panel title={t.t('about')} className="settings-card settings-card--about"><p><strong>{t.t('caption')}</strong> · {t.t('offlineSample')}</p><p>{controller.info?.version ? `ClaudeSync ${controller.info.version}` : 'ClaudeSync'}</p></Panel>
    </div>
  </StageFrame>;
}

export function BackupsStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--backups" layout="centered" title={t.t('backupTitle')} description={t.t('backupBody')} header={<PageArt kind="backup" />}>
    <div className="backups-page">{controller.backups.length === 0 ? <p className="empty-state">{t.t('noBackups')}</p> : <ul className="backup-list">{controller.backups.map((backup) => <li key={backup.id}><div><strong>{t.date(backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</strong><small>{t.t(backup.operation)} · {t.t(backup.fileCount === 1 ? 'backupFilesOne' : 'backupFiles', { count: backup.fileCount })}{backup.state !== 'verified' && ` · ${t.t('interrupted')}`}</small></div><Button variant="secondary" static disabled={controller.busy} onClick={() => { void controller.model.restore(backup.id); }}>{t.t('restore')}</Button></li>)}</ul>}<Button variant="secondary" static className="backups-open" onClick={() => void controller.model.openBackups()}>{t.t('openBackups')}</Button></div>
  </StageFrame>;
}
