import type { ApplyResult, OperationKind, OperationPreview } from '../shared/contracts';

export type ResultOutcome = 'trash' | 'backup' | 'trashAndBackup' | 'noBackup' | 'deleteNoTranscript';

/** Sessions with planned changes, counted once across accounts and files. */
export function changedSessionIds(preview: Pick<OperationPreview, 'changes'> | undefined): string[] {
  return [...new Set((preview?.changes ?? []).map((change) => change.sessionId).filter(Boolean))];
}

export function resultOutcome(kind: OperationKind | undefined, result: ApplyResult | undefined): ResultOutcome {
  const trash = (result?.trashCount ?? 0) > 0;
  const backup = Boolean(result?.backup);
  if (kind === 'delete' && !trash && !backup) return 'deleteNoTranscript';
  if (trash && backup) return 'trashAndBackup';
  if (trash) return 'trash';
  if (backup) return 'backup';
  return 'noBackup';
}
