import type { SessionView } from '../shared/contracts';

// The caller supplies one group; browsing may still contain excluded accounts.
export function sessionActionState(session: SessionView, included: ReadonlySet<string>) {
  const presence = session.presence.filter((item) => included.has(item.accountId));
  const hasSource = presence.some((item) => item.records === undefined || item.records.length > 0);
  const manageable = hasSource && presence.every((item) => item.records === undefined
    ? session.manageable
    : item.records.length > 0 && item.records.every((record) => record.manageable));
  const deletable = hasSource && presence.every((item) => item.records === undefined
    ? session.deletable ?? session.manageable
    : item.records.length > 0 && item.records.every((record) => record.deletable ?? record.manageable));
  const eligible = presence.some((item) => item.records === undefined
    ? item.eligible
    : item.records.some((record) => record.eligible));
  return { manageable, deletable, eligible, hasSource };
}

// Count existing source-account presence, not destinations or planned changes.
// Supply the full current group so search and Viewing cannot hide selection.
export function selectedSourceAccountIds(
  sessions: readonly SessionView[], selected: ReadonlySet<string>, included: ReadonlySet<string>,
): Set<string> {
  const accountIds = new Set<string>();
  for (const session of sessions) {
    if (!selected.has(session.id)) continue;
    for (const presence of session.presence) {
      if (included.has(presence.accountId)
        && (presence.records === undefined || presence.records.length > 0)) accountIds.add(presence.accountId);
    }
  }
  return accountIds;
}
