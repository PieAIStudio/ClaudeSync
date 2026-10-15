import type { DeleteRequest, SessionView } from '../shared/contracts';

export type DeleteState = 'active' | 'archived' | 'mixed';
export interface DeleteSelection extends DeleteRequest { state: DeleteState }

export function deletionSelection(sessions: SessionView[], selected: Set<string>, included: Set<string>, accountId: string): DeleteSelection {
  const accountIds = new Set<string>();
  const sessionIds: string[] = [];
  let active = false;
  let archived = false;
  for (const session of sessions) {
    if (!selected.has(session.id) || !session.manageable) continue;
    const targets = session.presence.filter((item) => included.has(item.accountId) && (accountId === 'all' || item.accountId === accountId));
    if (!targets.length) continue;
    sessionIds.push(session.id);
    for (const item of targets) {
      accountIds.add(item.accountId);
      active ||= item.active;
      archived ||= item.archived;
    }
  }
  return { sessionIds, accountIds: [...accountIds], state: active && archived ? 'mixed' : active ? 'active' : 'archived' };
}
