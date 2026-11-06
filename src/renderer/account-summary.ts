import type { WorkspaceView } from '../shared/contracts';

export interface AccountMissingSummary {
  accountId: string;
  missingCount: number | null;
  missingSessionIds: Set<string>;
}

// Catalog groups already enforce current-organization and retirement evidence.
export function summarizeAccounts(workspace: WorkspaceView | undefined, included: Set<string>) {
  const accounts: AccountMissingSummary[] = (workspace?.accounts ?? []).map((account) => ({
    accountId: account.id,
    missingCount: account.organizationVerified ? 0 : null,
    missingSessionIds: new Set<string>(),
  }));
  const participating = new Set((workspace?.accounts ?? [])
    .filter((account) => included.has(account.id) && account.organizationVerified)
    .map((account) => account.id));
  const missingSessionIds = new Set<string>();
  for (const session of workspace?.sessions ?? []) {
    const eligible = session.presence.some((presence) => participating.has(presence.accountId)
      && presence.records?.some((record) => record.group === 'visible' && record.eligible));
    if (!eligible) continue;
    for (const account of accounts) {
      if (!participating.has(account.accountId)) continue;
      const present = session.presence.some((presence) => presence.accountId === account.accountId
        && presence.records?.some((record) => record.group === 'visible' || record.group === 'archived'));
      if (present) continue;
      account.missingSessionIds.add(session.id);
      missingSessionIds.add(session.id);
    }
  }
  let missingCopies = 0;
  for (const account of accounts) {
    if (account.missingCount === null) continue;
    account.missingCount = account.missingSessionIds.size;
    missingCopies += account.missingCount;
  }
  return { accounts, missingSessionIds, missingCopies };
}
