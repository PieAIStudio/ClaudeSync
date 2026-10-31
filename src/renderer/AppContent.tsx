import { useTranslation } from './i18n';
import { Button, Input } from '@pieai/swimmer-ui-kit';
import { StageFrame } from './StageFrame';
import type { AppLocale } from './i18n';
import type { AppController } from './app-controller';
import { useAppController } from './app-controller';
import { AppShell } from './AppShell';
import { HomeStage, ProgressStage, ScanStage } from './HomeStages';
import { ResultsStage } from './ResultsStage';
import { ReviewStage } from './ReviewStage';
import { CompleteStage, SettingsStage, BackupsStage } from './UtilityStages';
import { CloudSessions } from './CloudSessions';
import { DeleteConfirmation, Modal, OperationReview } from './components';
import { OldCleanupDialog } from './OldCleanupDialog';
import { PageArt } from './visuals';

function CloudStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--cloud" title={t.t('cloudSessions')} description={t.t('cloudBody')} header={<PageArt kind="cloud" />}><CloudSessions refreshKey={controller.cloudRefresh} onBusy={controller.onCloudBusy} onRetry={controller.refreshCloud} /></StageFrame>;
}

function StageView({ controller }: { controller: AppController }) {
  switch (controller.stage) {
    case 'home': return <HomeStage controller={controller} />;
    case 'scan': return <ScanStage />;
    case 'results': return <ResultsStage controller={controller} />;
    case 'review': return <ReviewStage controller={controller} />;
    case 'progress': return <ProgressStage />;
    case 'complete': return <CompleteStage controller={controller} />;
    case 'cloud': return <CloudStage controller={controller} />;
    case 'backups': return <BackupsStage controller={controller} />;
    case 'settings': return <SettingsStage controller={controller} />;
  }
}

export function AppContent({ locale, onLocale }: { locale: AppLocale; onLocale(locale: AppLocale): void }) {
  const t = useTranslation();
  const controller = useAppController(locale, onLocale);
  const workspace = controller.workspace;
  return <div className={`claudesync-app theme-${controller.theme}`} data-stage={controller.stage} data-game-ui-theme={controller.theme} data-game-ui-style="quiet">
    <AppShell controller={controller}><StageView controller={controller} /></AppShell>
    {controller.review && workspace && <OperationReview preview={controller.review} choices={controller.request?.titleSelections} contentChoices={controller.request?.contentSelections} accounts={workspace.accounts} busy={controller.busy} blocked={workspace.blockers.length > 0} onClose={controller.model.closeReview} onApply={() => void controller.applyOperation()}
      onChooseContent={(id, path) => { if (controller.request) void controller.model.preview({ ...controller.request, contentSelections: { ...controller.request.contentSelections, [id]: path } }); }}
      onChooseTitle={(id, scope) => { if (controller.request) void controller.model.preview({ ...controller.request, titleSelections: { ...controller.request.titleSelections, [id]: scope || 'skip' } }); }} />}
    {controller.deleting && <DeleteConfirmation count={controller.deleting.sessionIds.length} accountNames={controller.deleting.names} state={controller.deleting.state} group={controller.deleting.group} busy={controller.busy} onClose={() => controller.setDeleting(undefined)} onDelete={() => { const request = controller.deleting!; controller.setDeleting(undefined); void controller.applyDeletion(request); }} />}
    {controller.oldPreview && <OldCleanupDialog preview={controller.oldPreview} busy={controller.cleanupBusy} blocked={false} onClose={() => controller.setOldPreview(undefined)} onConfirm={() => void controller.confirmOldCopies()} />}
    {controller.renameOpen && <Modal title={t.t('rename')} onClose={() => controller.setRenameOpen(false)} busy={controller.busy}
      actions={<><Button variant="secondary" static onClick={() => controller.setRenameOpen(false)}>{t.t('back')}</Button><Button variant="primary" disabled={controller.busy || !controller.newTitle.trim()} onClick={() => { controller.setRenameOpen(false); void controller.action('rename', controller.newTitle); }}>{t.t('previewRename')}</Button></> }>
      <label className="rename-field"><span>{t.t('titleInput')}</span><Input autoFocus value={controller.newTitle} maxLength={500} onChange={(event) => controller.setNewTitle(event.target.value)} /></label>
    </Modal>}
  </div>;
}
