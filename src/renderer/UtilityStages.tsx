import { Button, Callout, Icon, PageSurface, Select, Toggle } from '@pieai/swimmer-ui-kit';
import { useTranslation, locales } from './i18n';
import type { AppController } from './app-controller';
import { languageNames } from './app-types';
import { homeAccountLabel } from './app-helpers';
import { FolderSetting, Panel } from './components';
import { PageArt, RelayArt } from './visuals';

export function CompleteStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const failed = Boolean(controller.error);
  const title = failed ? t.t('issue') : controller.deleted ? t.t('deleteComplete') : controller.lastPreview?.kind === 'sync' ? t.t('syncCompleteCount', { count: controller.lastPreview.selected.length }) : t.t('operationCompleteTitle');
  const description = failed ? controller.error : controller.deleted ? t.t('deleteComplete') : t.t('operationCompleteBody');
  const completedItems = controller.lastPreview?.selected.length ? controller.lastPreview.selected.map((item) => ({
    title: item.title || t.t('untitled'),
    targets: [...new Set(controller.lastPreview!.changes.filter((change) => change.sessionId === item.id).map((change) => homeAccountLabel([...controller.included].indexOf(change.accountId), t)))].join('、') || controller.lastPreview!.accountIds.map((id) => homeAccountLabel([...controller.included].indexOf(id), t)).join('、'),
  })) : [];
  return <PageSurface className="stage-surface stage-surface--complete" title={title} description={description}><div className="complete-layout"><aside className="complete-art"><RelayArt state={failed ? 'attention' : 'complete'} celebrate={controller.celebrate} /></aside><section className="complete-card">
    <header><h1>{title}</h1><p>{description}</p></header>{failed && <Callout tone="danger">{controller.error}</Callout>}<p className="complete-proof">{t.t('complete')}</p>
    <ul className="completion-list">{completedItems.length ? completedItems.map((item) => <li key={item.title}><Icon icon="check" /><strong>{item.title}</strong><span>{item.targets}</span></li>) : <><li><Icon icon={failed ? 'alert' : 'check'} /><strong>{failed ? t.t('issue') : controller.deleted ? t.t('deleteComplete') : t.t('complete')}</strong><span>{controller.workspace ? t.t('checkedAt', { time: t.date(controller.workspace.checkedAt, { timeStyle: 'short' }) }) : ''}</span></li><li><Icon icon="lock" /><strong>{t.t('localOnly')}</strong><span>{t.t('operationCompleteBody')}</span></li></>}</ul>
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
    <div className="backups-page">{controller.backups.length === 0 ? <p className="empty-state">{t.t('noBackups')}</p> : <ul className="backup-list">{controller.backups.map((backup) => <li key={backup.id}><div><strong>{t.date(backup.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</strong><small>{t.t(backup.operation)} · {t.t('backupFiles', { count: backup.fileCount })}{backup.state !== 'verified' && ` · ${t.t('interrupted')}`}</small></div><Button variant="secondary" static disabled={controller.busy} onClick={() => { void controller.model.restore(backup.id); }}>{t.t('restore')}</Button></li>)}</ul>}<Button variant="secondary" static className="backups-open" onClick={() => void controller.model.openBackups()}>{t.t('openBackups')}</Button></div>
  </PageSurface>;
}
