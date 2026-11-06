import type { DeleteRequest, SessionView } from '../shared/contracts';
import { sessionActionState } from './session-action-state';

export type DeleteState = 'active' | 'archived' | 'mixed';
export interface DeleteSelection extends DeleteRequest { state: DeleteState }

export function deletionSelection(sessions: SessionView[], selected: Set<string>, included: Set<string>, accountId: string): DeleteSelection {
  const accountIds = new Set<string>();
  const sessionIds: string[] = [];
  let active = false;
  let archived = false;
  for (const session of sessions) {
    if (!selected.has(session.id)) continue;
    const targets = session.presence.filter((item) => included.has(item.accountId) && (accountId === 'all' || item.accountId === accountId));
    if (!targets.length || !sessionActionState(session, new Set(targets.map((item) => item.accountId))).deletable) continue;
    sessionIds.push(session.id);
    for (const item of targets) {
      accountIds.add(item.accountId);
      active ||= item.active;
      archived ||= item.archived;
    }
  }
  return { sessionIds, accountIds: [...accountIds], state: active && archived ? 'mixed' : active ? 'active' : 'archived' };
}
