import { Button, Callout, Icon, PageSurface, Select, Toggle } from '@pieai/swimmer-ui-kit';
import { useTranslation, locales } from './i18n';
import type { TranslationKey } from './i18n';
import type { AppController } from './app-controller';
import { languageNames } from './app-types';
import { homeAccountLabel } from './app-helpers';
import { FolderSetting, Panel } from './components';
import { PageArt, RelayArt } from './visuals';
import { resultOutcome, type ResultOutcome } from './result-copy';

export function CompleteStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const failed = Boolean(controller.error);
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
  const changedSessionIds = new Set((preview?.selected.length ? preview.selected.map((item) => item.id) : preview?.changes.map((change) => change.sessionId) ?? []).filter(Boolean));
  const count = changedSessionIds.size || preview?.selected.length || preview?.changes.length || 0;
  const title = failed ? t.t('issue')
    : operation === 'sync' ? t.t(count === 1 ? 'syncCompleteCountOne' : 'syncCompleteCount', { count })
    : operation === 'archive' ? t.t(count === 1 ? 'archiveCompleteCountOne' : 'archiveCompleteCount', { count })
    : operation === 'unarchive' ? t.t(count === 1 ? 'unarchiveCompleteCountOne' : 'unarchiveCompleteCount', { count })
    : operation === 'restore' && preview?.backup ? t.t('restoreComplete', { date: t.date(preview.backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })
    : t.t('operationCompleteTitle');
  const includedIds = [...controller.included];
  const accountLabel = (id: string) => {
    const index = includedIds.indexOf(id);
    return index >= 0 ? homeAccountLabel(index, t) : t.t('unknown', { id: id.slice(0, 8) });
  };
  const accountSeparator = t.locale === 'zh-CN' ? '、' : ', ';
  const scopeIds = preview?.backup?.affectedAccountIds?.length ? preview.backup.affectedAccountIds : preview?.accountIds ?? [];
  const scope = [...new Set(scopeIds)].map(accountLabel).join(accountSeparator) || t.t('allAccounts');
  const destinationKey: TranslationKey = operation === 'archive' ? 'receiptArchiveDestination'
    : operation === 'unarchive' ? 'receiptUnarchiveDestination' : operation === 'restore' ? 'receiptRestoreDestination' : 'receiptSyncDestination';
  const destination = t.t(destinationKey);
  const scopedDescription = operation && ['sync', 'archive', 'unarchive', 'restore'].includes(operation)
    ? t.t('receiptScopeDestination', { scope, destination }) : summary;
  const description = failed ? controller.error : scopedDescription;
  const completedItems = preview?.backup ? [{
    title: t.t(preview.backup.fileCount === 1 ? 'backupFilesOne' : 'backupFiles', { count: preview.backup.fileCount }),
    targets: t.t('receiptScopeDestination', { scope, destination }),
  }] : preview?.selected.length ? preview.selected.map((item) => {
    const itemIds = [...new Set(preview.changes.filter((change) => change.sessionId === item.id).map((change) => change.accountId))];
    const itemScope = itemIds.map(accountLabel).join(accountSeparator) || scope;
    return { title: item.title || t.t('untitled'), targets: t.t('receiptScopeDestination', { scope: itemScope, destination }) };
  }) : [];
  return <PageSurface className="stage-surface stage-surface--complete" title={title} description={description}><div className="complete-layout"><aside className="complete-art"><RelayArt state={failed ? 'attention' : 'complete'} celebrate={controller.celebrate} /></aside><section className="complete-card">
    <header><h1>{title}</h1><p>{description}</p></header>{failed && <Callout tone="danger">{controller.error}</Callout>}<p className="complete-proof">{t.t(failed ? 'issue' : 'resultVerified')}</p>
    <ul className="completion-list">{completedItems.length ? completedItems.map((item) => <li key={item.title}><Icon icon="check" /><strong>{item.title}</strong><span>{item.targets}</span></li>) : <><li><Icon icon={failed ? 'alert' : 'check'} /><strong>{failed ? t.t('issue') : t.t('resultVerified')}</strong><span>{controller.workspace ? t.t('checkedAt', { time: t.date(controller.workspace.checkedAt, { timeStyle: 'short' }) }) : ''}</span></li><li><Icon icon="lock" /><strong>{t.t('localOnly')}</strong><span>{t.t('operationCompleteBody')}</span></li></>}</ul>
    <footer><Button variant="ghost" static onClick={() => controller.setStage('review')}>{t.t('viewScope')}</Button><Button variant="primary" onClick={() => { controller.setCelebrate(false); controller.setReviewCategory('all'); controller.setStage(controller.workspace ? 'review' : 'home'); }}>{t.t('returnToChats')}</Button></footer>
  </section></div></PageSurface>;
}

export function SettingsStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <PageSurface className="stage-surface stage-surface--settings" layout="centered" title={t.t('settings')} header={<PageArt kind="settings" />} primaryAction={<Button variant="primary" disabled={controller.busy || !controller.sessionRoot || !controller.projectsRoot} onClick={() => void controller.saveFolders()}>{t.t('saveFolders')}</Button>}>
    {!controller.api && <Callout tone="warning">{t.t('needDesktop')}</Callout>}<div className="settings-grid">
      <Panel title={t.t('preferences')} className="settings-card"><label><span>{t.t('language')}</span><Select value={controller.locale} onChange={(event) => controller.onLocale(event.target.value as typeof controller.locale)}>{locales.map((code) => <option key={code} value={code}>{languageNames[code]}</option>)}</Select></label><Toggle checked={controller.compact} label={t.t('compactList')} onClick={() => controller.setCompact((value) => !value)} /><Toggle checked={controller.reducedMotion} label={t.t('reduceMotion')} onClick={() => controller.setReducedMotion((value) => !value)} /></Panel>
      <Panel title={t.t('foldersTitle')} className="settings-card"><FolderSetting label={t.t('indexFolder')} path={controller.sessionRoot} busy={controller.busy} onChoose={() => void controller.model.chooseDirectory().then((path) => { if (path) controller.setSessionRoot(path); })} /><FolderSetting label={t.t('transcriptFolder')} path={controller.projectsRoot} busy={controller.busy} onChoose={() => void controller.model.chooseDirectory().then((path) => { if (path) controller.setProjectsRoot(path); })} /><p className="settings-note">{t.t('localOnly')}</p></Panel>
      <Panel title={t.t('about')} className="settings-card settings-card--about"><p><strong>{t.t('caption')}</strong> · {t.t('offlineSample')}</p><p>{controller.info?.version ? `ClaudeSync ${controller.info.version}` : 'ClaudeSync'}</p></Panel>
    </div>
  </PageSurface>;
}

export function BackupsStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <PageSurface className="stage-surface stage-surface--backups" layout="centered" title={t.t('backupTitle')} description={t.t('backupBody')} header={<PageArt kind="backup" />}>
    <div className="backups-page">{controller.backups.length === 0 ? <p className="empty-state">{t.t('noBackups')}</p> : <ul className="backup-list">{controller.backups.map((backup) => <li key={backup.id}><div><strong>{t.date(backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</strong><small>{t.t(backup.operation)} · {t.t(backup.fileCount === 1 ? 'backupFilesOne' : 'backupFiles', { count: backup.fileCount })}{backup.state !== 'verified' && ` · ${t.t('interrupted')}`}</small></div><Button variant="secondary" static disabled={controller.busy} onClick={() => { void controller.model.restore(backup.id); }}>{t.t('restore')}</Button></li>)}</ul>}<Button variant="secondary" static className="backups-open" onClick={() => void controller.model.openBackups()}>{t.t('openBackups')}</Button></div>
  </PageSurface>;
}
