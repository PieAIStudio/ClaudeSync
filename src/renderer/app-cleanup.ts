import { useState } from 'react';
import type { OldCleanupPreview, WorkspaceView } from '../shared/contracts';
import { errorMessage } from './errors';
import type { useTranslation } from './i18n';
import type { useWorkspace } from './useWorkspace';

type WorkspaceModel = ReturnType<typeof useWorkspace>;
type Translation = ReturnType<typeof useTranslation>;

export function useOldCleanup(model: WorkspaceModel, workspace: WorkspaceView | undefined, included: Set<string>, accountFilter: string, t: Translation) {
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [oldPreview, setOldPreview] = useState<OldCleanupPreview>();
  const [cleanupFeedback, setCleanupFeedback] = useState('');

  async function reviewOldCopies() {
    if (!workspace || !model.api) return;
    const ids = accountFilter === 'all' ? [...included] : included.has(accountFilter) ? [accountFilter] : [];
    if (!ids.length) return;
    setCleanupBusy(true); setCleanupFeedback('');
    try {
      const preview = await model.api.previewOldCopies(ids, workspace.revision);
      if (!preview.items.length) setCleanupFeedback(t.t('cleanupNone'));
      else setOldPreview(preview);
    } catch (error) { setCleanupFeedback(errorMessage(error, t.locale)); }
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
      setOldPreview(undefined); setCleanupFeedback(errorMessage(error, t.locale)); await model.refresh();
    } finally { setCleanupBusy(false); }
  }

  return { cleanupBusy, oldPreview, cleanupFeedback, setOldPreview, reviewOldCopies, confirmOldCopies };
}
