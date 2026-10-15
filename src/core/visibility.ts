import { accountIdForScope } from './account-identity';
import { historyIds, isUuid } from './record';
import type { Account, SessionEntry } from './types';
import type { Workspace } from './workspace';
import type { SessionGroup } from '../shared/contracts';

export type VerifiedOrganizations = Readonly<Record<string, string>>;

// These are the conservative, Owner-approved local rules, not a claim about
// uninspected Desktop internals. Never infer a scope from its name or row count.
export function verifiedOrganization(workspace: Workspace, accountId: string): string | undefined {
  const organization = workspace.verifiedOrganizations?.[accountId];
  return isUuid(organization) && workspace.accounts.some((account) => account.scope === `${accountId}/${organization}`)
    ? organization : undefined;
}

export function verifiedTargets(accounts: Account[], organizations: VerifiedOrganizations = {}): Account[] {
  const result: Account[] = [];
  for (const id of new Set(accounts.map((account) => accountIdForScope(account.scope)))) {
    const organization = organizations[id];
    const target = isUuid(organization) ? accounts.find((account) => account.scope === `${id}/${organization}`) : undefined;
    if (!target) throw new Error('尚未核实所选账号的当前组织，不能同步。请先在 Claude Desktop 切换到该账号并重新检查；当前组织目录也必须包含在设置中。');
    result.push(target);
  }
  return result;
}

export function deletionMarkers(workspace: Workspace, accountId: string): Set<string> {
  const markers = new Set<string>();
  for (const path of workspace.snapshot.files.keys()) {
    const [id, , name, extra] = path.split('/');
    if (id === accountId && !extra && name?.startsWith('deleted_') && isUuid(name.slice(8))) markers.add(name.slice(8));
  }
  return markers;
}

export function hasDeletionMarker(workspace: Workspace, entry: SessionEntry): boolean {
  const markers = deletionMarkers(workspace, accountIdForScope(entry.account.scope));
  return [...historyIds(entry.data), entry.data.sessionId, entry.data.sessionId.replace(/^local_/u, '')].some((id) => markers.has(id));
}

export function entryGroup(workspace: Workspace, entry: SessionEntry): SessionGroup {
  if (hasDeletionMarker(workspace, entry)) return 'deleted';
  const organization = verifiedOrganization(workspace, accountIdForScope(entry.account.scope));
  if (organization && entry.account.scope.split('/')[1] !== organization) return 'oldOrganization';
  if (entry.data.scheduledTaskId) return 'scheduled';
  if (entry.archived) return 'archived';
  return organization ? 'visible' : 'unverified';
}
