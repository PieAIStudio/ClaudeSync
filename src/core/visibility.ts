import { accountIdForScope } from './account-identity';
import { historyIds, isUuid } from './record';
import type { Account, SessionEntry, VerifiedOrganizations, VisibilityWorkspace } from './types';
import type { SessionGroup } from '../shared/contracts';
import { userError } from '../error-copy';

// These are the conservative, Owner-approved local rules, not a claim about
// uninspected Desktop internals. Never infer a scope from its name or row count.
export function verifiedOrganization(workspace: VisibilityWorkspace, accountId: string): string | undefined {
  const organization = workspace.verifiedOrganizations?.[accountId];
  return isUuid(organization) && workspace.accounts.some((account) => account.scope === `${accountId}/${organization}`)
    ? organization : undefined;
}

export function verifiedTargets(accounts: Account[], organizations: VerifiedOrganizations = {}): Account[] {
  const result: Account[] = [];
  for (const id of new Set(accounts.map((account) => accountIdForScope(account.scope)))) {
    const organization = organizations[id];
    const target = isUuid(organization) ? accounts.find((account) => account.scope === `${id}/${organization}`) : undefined;
    if (!target) throw userError('errorOrganizationUnverified');
    result.push(target);
  }
  return result;
}

export function deletionMarkers(workspace: VisibilityWorkspace, accountId: string): Set<string> {
  const markers = new Set<string>();
  for (const path of workspace.snapshot.files.keys()) {
    const [id, , name, extra] = path.split('/');
    if (id === accountId && !extra && name?.startsWith('deleted_') && isUuid(name.slice(8))) markers.add(name.slice(8));
  }
  return markers;
}

export function hasDeletionMarker(workspace: VisibilityWorkspace, entry: SessionEntry): boolean {
  const markers = deletionMarkers(workspace, accountIdForScope(entry.account.scope));
  return [...historyIds(entry.data), entry.data.sessionId, entry.data.sessionId.replace(/^local_/u, '')].some((id) => markers.has(id));
}

export function entryGroup(workspace: VisibilityWorkspace, entry: SessionEntry): SessionGroup {
  if (hasDeletionMarker(workspace, entry)) return 'deleted';
  const organization = verifiedOrganization(workspace, accountIdForScope(entry.account.scope));
  if (organization && entry.account.scope.split('/')[1] !== organization) {
    // A current organization is not evidence that another membership ended.
    return workspace.retiredOrganizationScopes?.includes(entry.account.scope) ? 'oldOrganization' : 'unverified';
  }
  if (entry.data.scheduledTaskId) return 'scheduled';
  if (entry.archived) return 'archived';
  return organization ? 'visible' : 'unverified';
}
