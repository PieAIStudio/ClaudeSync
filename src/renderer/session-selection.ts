import type { SessionView } from '../shared/contracts';

export type SessionFilter = 'all' | 'active' | 'archived' | 'syncable' | 'blocked' | 'starred';

export function filterSessions(sessions: SessionView[], options: {
  accountId: string; included: Set<string>; filter: SessionFilter; search: string; sort: 'updated' | 'title';
}): SessionView[] {
  const search = options.search.trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    const presence = session.presence.filter((item) => options.accountId === 'all' ? options.included.has(item.accountId) : item.accountId === options.accountId);
    if (!presence.length) return false;
    const active = presence.some((item) => item.active);
    const eligible = presence.some((item) => item.eligible);
    if (options.filter === 'active' && !active || options.filter === 'archived' && active
      || options.filter === 'syncable' && !eligible || options.filter === 'blocked' && eligible
      || options.filter === 'starred' && !session.starred) return false;
    if (search && ![session.title, session.project, session.id, ...presence.flatMap((item) => item.titles)].join(' ').toLocaleLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => options.sort === 'title' ? a.title.localeCompare(b.title)
    : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title));
}
