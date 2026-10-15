import { accountIdForScope } from './account-identity';
import { isUuid, REMOTE_KEYS } from './record';
import { titleOrigin } from './title-policy';
import { deletionMarkers, entryGroup, verifiedOrganization } from './visibility';
import type { Workspace } from './workspace';
import type { SessionEntry } from './types';
import type { AccountView, SessionCopyView, SessionGroup, SessionView } from '../shared/contracts';

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
  const classification = new Map(workspace.entries.map((entry) => [entry.path, entryGroup(workspace, entry)]));
  const groupOf = (entry: SessionEntry) => classification.get(entry.path)!;
  for (const entry of workspace.entries) {
    const id = sessionKey(entry);
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  const sessions: SessionView[] = [...groups].map(([id, entries]) => {
    const preferred = [...entries].sort((a, b) => Number(groupOf(b) === 'visible') - Number(groupOf(a) === 'visible')
      || Number(titleOrigin(b.data) === 'manual') - Number(titleOrigin(a.data) === 'manual')
      || Number(b.eligible) - Number(a.eligible) || a.path.localeCompare(b.path))[0]!;
    const accountIds = [...new Set(entries.map((entry) => accountIdForScope(entry.account.scope)))];
    const dates = entries.map((entry) => timestamp(entry.data.lastActivityAt ?? entry.data.createdAt)).filter((date): date is string => Boolean(date)).sort();
    return {
      id, title: preferred.data.title || '',
      project: typeof preferred.data.cwd === 'string' ? preferred.data.cwd : '',
      updatedAt: dates.at(-1), starred: entries.some((entry) => entry.data.isStarred),
      manageable: entries.some((entry) => isManageable(entry) && groupOf(entry) !== 'deleted'),
      presence: accountIds.map((accountId) => {
        const copies = entries.filter((entry) => accountIdForScope(entry.account.scope) === accountId);
        const records: SessionCopyView[] = copies.map((entry) => ({
          scope: entry.account.scope, group: groupOf(entry), title: entry.data.title || '',
          project: typeof entry.data.cwd === 'string' ? entry.data.cwd : '',
          updatedAt: timestamp(entry.data.lastActivityAt ?? entry.data.createdAt),
          archived: Boolean(entry.archived), eligible: entry.eligible,
          manageable: isManageable(entry) && groupOf(entry) !== 'deleted', starred: Boolean(entry.data.isStarred),
          reasons: entry.syncIssue ? [entry.syncIssue] : [],
        }));
        return {
          accountId, active: records.some((entry) => entry.group === 'visible'),
          archived: records.some((entry) => entry.group === 'archived') && !records.some((entry) => entry.group === 'visible'),
          eligible: records.some((entry) => entry.group === 'visible' && entry.eligible),
          copies: records.length, titles: [...new Set(records.map((entry) => entry.title))],
          reasons: [...new Set(records.flatMap((entry) => entry.reasons))], records,
        };
      }),
    };
  }).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title));
  const accountIds = [...new Set(workspace.accounts.map((account) => accountIdForScope(account.scope)))];
  const accounts: AccountView[] = accountIds.map((id) => {
    const presence = sessions.flatMap((session) => session.presence.filter((item) => item.accountId === id));
    const count = (group: SessionGroup) => presence.filter((item) => item.records?.some((copy) => copy.group === group)).length;
    const organizationVerified = Boolean(verifiedOrganization(workspace, id));
    return {
      id, email: emails[id], current: id === currentId,
      scopes: workspace.accounts.filter((account) => accountIdForScope(account.scope) === id).map((account) => account.scope),
      organizationVerified, visible: organizationVerified ? count('visible') : null,
      active: count('visible'), archived: count('archived'), scheduled: count('scheduled'), oldCopies: count('oldOrganization'),
      deletedMarkers: deletionMarkers(workspace, id).size, unverified: count('unverified'),
      total: presence.length, eligible: presence.filter((item) => item.eligible).length,
      copies: presence.reduce((sum, item) => sum + item.copies, 0),
    };
  });
  return { accounts, sessions };
}
