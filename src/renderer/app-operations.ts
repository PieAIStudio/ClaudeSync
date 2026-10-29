import { useState } from 'react';
import type { DeleteSelection } from './deletion-selection';
import type { OperationRequest, SessionGroup, WorkspaceView } from '../shared/contracts';
import type { Stage } from './app-types';
import type { useWorkspace } from './useWorkspace';

type WorkspaceModel = ReturnType<typeof useWorkspace>;
type SetStage = (value: Stage) => void;
type SetSelected = (value: Set<string>) => void;

type OperationInput = {
  model: WorkspaceModel;
  workspace: WorkspaceView | undefined;
  included: Set<string>;
  accountFilter: string;
  selected: Set<string>;
  selectionGroup: SessionGroup;
  setStage: SetStage;
  setSelected: SetSelected;
};

export function useAppOperations({ model, workspace, included, accountFilter, selected, selectionGroup, setStage, setSelected }: OperationInput) {
  const [celebrate, setCelebrate] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [lastPreview, setLastPreview] = useState<NonNullable<WorkspaceModel['review']>>();

  async function startCheck() {
    setHasChecked(true);
    setStage('scan');
    await model.refresh();
    setStage('results');
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
    setLastPreview(undefined);
    setStage('progress');
    const success = await model.deleteSelected(request, request.revision);
    setCelebrate(false);
    if (success) setSelected(new Set());
    setStage('complete');
  }

  async function saveFolders(sessionRoot: string, projectsRoot: string) {
    const success = await model.configure(sessionRoot, projectsRoot);
    if (success) setStage('results');
  }

  async function openBackups() {
    const success = await model.loadBackups();
    if (success) setStage('backups');
  }

  return { celebrate, setCelebrate, hasChecked, lastPreview, startCheck, action, applyOperation, applyDeletion, saveFolders, openBackups };
}
