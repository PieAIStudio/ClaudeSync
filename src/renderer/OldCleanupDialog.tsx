import { GameButton } from '@pieai/swimmer-ui-kit';
import type { OldCleanupPreview } from '../shared/contracts';
import { TermTip } from './TermTip';
import { Modal } from './components';
import { useTranslation } from './i18n';

export function OldCleanupDialog({ preview, busy, blocked, onClose, onConfirm }: {
  preview: OldCleanupPreview; busy: boolean; blocked: boolean;
  onClose(): void; onConfirm(): void;
}) {
  const t = useTranslation();
  return <Modal title={t.t('cleanupOldTitle')} busy={busy} onClose={onClose}>
    <div className="count-with-tip"><strong>{t.t('cleanupOldSummary', {
      total: preview.trashCount, imported: preview.archivedToImport
    })}</strong><TermTip term="oldCleanup" /></div>
    <p className="panel-intro">{t.t('cleanupOldReview')}</p>
    <p className="panel-intro">{t.t('tipOldOrganization')}</p>
    <p className="panel-intro">{t.t('scopedWriteCheck')}</p>
    <ul className="cleanup-copy-list">{preview.items.map((item, index) => <li key={item.oldScope + ':' + item.sessionId + ':' + index}>
      <strong>{item.title || t.t('untitled')}</strong>
      <small>{t.t('cleanupOldScope', { code: item.oldScope.split('/').at(-1)?.slice(0, 8) ?? '?' })}</small>
      <span>{item.currentHasCopy ? t.t('cleanupOldYes') : t.t('cleanupOldNo')}</span>
      <span>{t.t(item.action === 'trashDuplicate' ? 'cleanupOldTrash'
        : item.action === 'restoreArchived' ? 'cleanupOldImport' : 'cleanupOldAlsoTrash')}</span>
    </li>)}</ul>
    {blocked && <p className="operation-warning">{t.t('cleanupNeedQuit')}</p>}
    <div className="dialog-actions">
      <GameButton variant="secondary" autoFocus disabled={busy} onClick={onClose}>{t.t('cancel')}</GameButton>
      <GameButton variant="danger" disabled={busy || blocked || !preview.token} onClick={onConfirm}>
        {t.t('cleanupOldConfirm', { count: preview.trashCount })}
      </GameButton>
    </div>
  </Modal>;
}
