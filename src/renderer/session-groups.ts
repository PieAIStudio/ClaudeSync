import type { SessionGroup, SessionView } from '../shared/contracts';

// Project each category before filtering, selecting, or deleting. A CLI ID may
// occur in multiple categories; no hidden copy may contribute title or state.
export function sessionsInGroup(sessions: SessionView[], group: SessionGroup, accountId: string, included: Set<string>): SessionView[] {
  return sessions.flatMap((session) => {
    const presence = session.presence.filter((item) => accountId === 'all' ? included.has(item.accountId) : item.accountId === accountId)
      .flatMap((item) => {
        const records = item.records?.filter((record) => record.group === group) ?? [];
        if (!records.length) return [];
        return [{ ...item, records, copies: records.length,
          active: records.some((record) => !record.archived), archived: records.every((record) => record.archived),
          eligible: records.some((record) => record.eligible), titles: [...new Set(records.map((record) => record.title))],
          reasons: [...new Set(records.flatMap((record) => record.reasons))],
        }];
      });
    if (!presence.length) return [];
    const records = presence.flatMap((item) => item.records);
    const preferred = records[0]!;
    return [{ ...session, presence, title: preferred.title, project: preferred.project,
      updatedAt: records.flatMap((record) => record.updatedAt ? [record.updatedAt] : []).sort().at(-1),
      starred: records.some((record) => record.starred), manageable: records.every((record) => record.manageable),
    }];
  });
}
