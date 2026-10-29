import type { ApplyResult, OperationKind } from '../shared/contracts';

export type ResultOutcome = 'trash' | 'backup' | 'trashAndBackup' | 'noBackup' | 'deleteNoTranscript';

export function resultOutcome(kind: OperationKind | undefined, result: ApplyResult | undefined): ResultOutcome {
  const trash = (result?.trashCount ?? 0) > 0;
  const backup = Boolean(result?.backup);
  if (kind === 'delete' && !trash && !backup) return 'deleteNoTranscript';
  if (trash && backup) return 'trashAndBackup';
  if (trash) return 'trash';
  if (backup) return 'backup';
  return 'noBackup';
}
