import { accountIdForScope } from './account-identity';
import { isUuid, REMOTE_KEYS } from './record';
import { titleOrigin } from './title-policy';
import type { Workspace } from './workspace';
import type { SessionEntry } from './types';
import type { AccountView, SessionView } from '../shared/contracts';

export function sessionKey(entry: SessionEntry): string {
  return isUuid(entry.data.cliSessionId) ? entry.data.cliSessionId : `entry:${entry.path}`;
}

export function isManageable(entry: SessionEntry): boolean {
  return isUuid(entry.data.cliSessionId) && !entry.data.scheduledTaskId
    && !REMOTE_KEYS.some((key) => Boolean(entry.data[key]));
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

export function buildCatalog(workspace: Workspace, emails: Record<string, string> = {}, currentId?: string) {
  const groups = new Map<string, SessionEntry[]>();
  for (const entry of workspace.entries) {
    const id = sessionKey(entry);
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  const sessions: SessionView[] = [...groups].map(([id, entries]) => {
    const preferred = [...entries].sort((a, b) => Number(titleOrigin(b.data) === 'manual') - Number(titleOrigin(a.data) === 'manual')
      || Number(b.eligible) - Number(a.eligible) || a.path.localeCompare(b.path))[0]!;
    const accountIds = [...new Set(entries.map((entry) => accountIdForScope(entry.account.scope)))];
    const dates = entries.map((entry) => timestamp(entry.data.lastActivityAt ?? entry.data.createdAt)).filter((date): date is string => Boolean(date)).sort();
    return {
      id,
      title: preferred.data.title || '',
      project: typeof preferred.data.cwd === 'string' ? preferred.data.cwd : '',
      updatedAt: dates.at(-1),
      starred: entries.some((entry) => entry.data.isStarred),
      manageable: entries.every(isManageable),
      presence: accountIds.map((accountId) => {
        const copies = entries.filter((entry) => accountIdForScope(entry.account.scope) === accountId);
        return {
          accountId,
          active: copies.some((entry) => !entry.archived),
          archived: copies.every((entry) => entry.archived),
          eligible: copies.some((entry) => entry.eligible),
          copies: copies.length,
          titles: [...new Set(copies.map((entry) => entry.data.title || ''))],
          reasons: [...new Set(copies.flatMap((entry) => entry.syncIssue ? [entry.syncIssue] : []))],
        };
      }),
    };
  }).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title));
  const accountIds = [...new Set(workspace.accounts.map((account) => accountIdForScope(account.scope)))];
  const accounts: AccountView[] = accountIds.map((id) => {
    const presence = sessions.flatMap((session) => session.presence.filter((item) => item.accountId === id));
    return {
      id, email: emails[id], current: id === currentId,
      scopes: workspace.accounts.filter((account) => accountIdForScope(account.scope) === id).map((account) => account.scope),
      active: presence.filter((item) => item.active).length,
      archived: presence.filter((item) => item.archived).length,
      total: presence.length,
      eligible: presence.filter((item) => item.eligible).length,
      copies: presence.reduce((sum, item) => sum + item.copies, 0),
    };
  });
  return { accounts, sessions };
}
