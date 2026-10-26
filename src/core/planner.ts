import type { Account, PlannedAddition, SessionEntry, SyncPlan } from './types';
import { buildTitleActions, titleOrigin } from './title-policy';
import { deterministicBranchIndexId, historyIds, isUuid, portableRecord } from './record';
import { verifiedTargets, type VerifiedOrganizations } from './visibility';
import { userMessage } from '../error-copy';

export interface PlanOptions {
  verifiedOrganizations?: VerifiedOrganizations;
  tombstones?: Set<string>;
  archivedByAccount?: Map<string, Set<string>>;
  titleSelections?: Record<string, string>;
  selectedSessionIds?: readonly string[];
  sourcePaths?: readonly string[];
}

export function buildPlan(accounts: Account[], entries: SessionEntry[], options: PlanOptions = {}): SyncPlan {
  accounts = verifiedTargets(accounts, options.verifiedOrganizations);
  const targetScopes = new Set(accounts.map((account) => account.scope));
  const selected = options.selectedSessionIds ? new Set(options.selectedSessionIds) : undefined;
  const sources = options.sourcePaths ? new Set(options.sourcePaths) : undefined;
  const sourceIds = new Set(entries.filter((entry) => entry.eligible && (!sources || sources.has(entry.path))).map((entry) => entry.data.cliSessionId));
  const titleActions = buildTitleActions(entries.filter((entry) => targetScopes.has(entry.account.scope) && entry.eligible && sourceIds.has(entry.data.cliSessionId) && (!selected || selected.has(entry.data.cliSessionId ?? ''))), options.titleSelections);
  const additions: PlannedAddition[] = [];
  const skipped: NonNullable<SyncPlan['skipped']> = [];
  const existingByAccount = new Map<string, Set<string>>();
  const existingByPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const account of accounts) existingByAccount.set(account.scope, new Set());
  for (const entry of entries) {
    if (isUuid(entry.data.cliSessionId)) existingByAccount.get(entry.account.scope)?.add(entry.data.cliSessionId);
  }

  for (const source of entries) {
    if (sources && !sources.has(source.path)) continue;
    if (selected && !selected.has(source.data.cliSessionId ?? '')) continue;
    if (!source.eligible || !isUuid(source.data.cliSessionId)) continue;
    for (const target of accounts) {
      if (target.scope === source.account.scope) continue;
      const existing = existingByAccount.get(target.scope);
      if (!existing || existing.has(source.data.cliSessionId)) continue;
      const ids = historyIds(source.data);
      const peers = entries.filter((entry) => entry.eligible && entry.data.cliSessionId === source.data.cliSessionId && (!sources || sources.has(entry.path)));
      const chosen = peers.find((entry) => entry.account.scope === options.titleSelections?.[source.data.cliSessionId!]);
      const manual = peers.filter((entry) => titleOrigin(entry.data) === 'manual');
      const preferred = chosen ?? (new Set(manual.map((entry) => entry.data.title)).size === 1 ? manual[0] : undefined);
      const title = preferred?.data.title || source.data.title || '未命名会话';
      if ([...ids].some((id) => options.tombstones?.has(id))) {
        skipped.push({ source: source.account, target, title, reason: userMessage('statusDeletedHistoryPreventsResurrection') });
        continue;
      }
      let copiedSessionId = source.data.sessionId;
      let targetPath = `${target.scope}/${copiedSessionId}.json`;
      if (existingByPath.has(targetPath)) {
        copiedSessionId = `local_${deterministicBranchIndexId(target.scope, source.data.cliSessionId)}`;
        targetPath = `${target.scope}/${copiedSessionId}.json`;
      }
      const destinationIds = new Set([copiedSessionId, copiedSessionId.startsWith('local_') ? copiedSessionId.slice(6) : copiedSessionId]);
      if ([...destinationIds].some((id) => options.tombstones?.has(id))) {
        skipped.push({ source: source.account, target, title, reason: userMessage('statusDeletedEntryPreventsResurrection') });
        continue;
      }
      if ([...destinationIds].some((id) => options.archivedByAccount?.get(target.scope)?.has(id))) {
        skipped.push({ source: source.account, target, title, reason: userMessage('statusTargetArchived') });
        continue;
      }
      if (existingByPath.has(targetPath)) {
        skipped.push({ source: source.account, target, title, reason: userMessage('statusBranchEntryOccupied') });
        continue;
      }
      additions.push({
        source,
        target,
        targetPath,
        data: portableRecord({ ...source.data, ...(preferred ? { titleSource: preferred.data.titleSource } : {}) }, copiedSessionId === source.data.sessionId ? undefined : copiedSessionId, title),
      });
      existing.add(source.data.cliSessionId);
      existingByPath.set(targetPath, { ...source, account: target, path: targetPath });
    }
  }

  return {
    additions,
    titleActions,
    skipped,
  };
}
