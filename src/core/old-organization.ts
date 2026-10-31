import { assertDependencySnapshot, captureDependencies, dependencyError, type DataDependencies } from './data-scope';
import { dirname, join } from 'node:path';
import { accountIdForScope } from './account-identity';
import { buildCatalog, isManageable, sessionKey } from './catalog';
import { deterministicBranchIndexId, isUuid, portableRecord } from './record';
import { acquireFileLock, assertPlainDirectory, assertTranscriptCurrent, publishNewFile, readRegularFile, safeWorkspacePath, snapshotWithAdded, snapshotWithRemoved, snapshotWithReplaced, replaceRegularFile, takeWorkspaceSnapshot } from './storage';
import { encodeJson } from './transaction';
import { entryGroup, hasDeletionMarker, verifiedOrganization } from './visibility';
import { collectTranscriptIndex, loadWorkspace } from './workspace';
import type { Workspace } from './workspace';

import type { OldCopyItemView } from '../shared/contracts';
import { userError, userMessage } from '../error-copy';

export interface OldCleanupPlan {
  dependencies: DataDependencies;
  items: OldCopyItemView[];
  removals: Array<{ path: string; raw: Buffer }>;
  imports: Array<{ path: string; raw: Buffer }>;
  archiveHints: Array<{ path: string; before?: Buffer; after: Buffer }>;
  accountIds: string[];
  expectedMain: Record<string, number>;
}

// An old-only conversation is returned ARCHIVED, so cleanup never increases the
// account's ordinary sidebar number. The Owner can later unarchive or delete it.
export function planOldCleanup(workspace: Workspace, selectedAccountIds: readonly string[]): OldCleanupPlan {
  const accountIds = [...new Set(selectedAccountIds)];
  if (!accountIds.length || accountIds.length > 50) throw userError('errorCleanupAccountsRequired');
  const expectedMain: Record<string, number> = {};
  const items: OldCopyItemView[] = [];
  const removals: OldCleanupPlan['removals'] = [];
  const imports: OldCleanupPlan['imports'] = [];
  const pendingArchive = new Map<string, Set<string>>();
  const reserved = new Set(workspace.snapshot.files.keys());
  const catalog = buildCatalog(workspace);

  for (const id of accountIds) {
    if (!isUuid(id) || !workspace.accounts.some((account) => accountIdForScope(account.scope) === id))
      throw userError('errorCleanupUnknownAccount');
    const organization = verifiedOrganization(workspace, id);
    if (!organization) throw userError('errorCleanupOrganizationUnverified');
    const currentScope = id + '/' + organization;
    const scannedPaths = new Set(workspace.entries.map((entry) => entry.path));
    for (const path of workspace.snapshot.files.keys()) {
      const [owner, org, name, extra] = path.split('/');
      if (owner === id && org !== organization && !extra && /^local_[0-9a-f-]{36}\.json$/u.test(name ?? '') && !scannedPaths.has(path))
        throw userError('errorCleanupUnconfiguredCopy');
    }
    const count = catalog.accounts.find((account) => account.id === id)?.visible;
    if (count === null || count === undefined) throw userError('errorCleanupMainCountUnverified');
    expectedMain[id] = count;
    const inCurrent = new Set(workspace.entries.filter((e) => e.account.scope === currentScope).map(sessionKey));
    const broughtBack = new Set<string>();
    const old = workspace.entries.filter((e) => accountIdForScope(e.account.scope) === id && e.account.scope !== currentScope
      && workspace.retiredOrganizationScopes?.includes(e.account.scope))
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of old) {
      if (!isUuid(entry.data.cliSessionId) || !isManageable(entry) || hasDeletionMarker(workspace, entry) || entryGroup(workspace, entry) !== 'oldOrganization')
        throw userError('errorCleanupUnsupportedRecords');
      const key = sessionKey(entry);
      const currentHasCopy = inCurrent.has(key);
      const hasPlannedImport = broughtBack.has(key);
      let action: OldCopyItemView['action'] = 'trashDuplicate';
      if (!currentHasCopy && !hasPlannedImport) {
        if (entry.syncIssue) throw userError('errorCleanupMissingTranscript');
        let stem = entry.data.sessionId;
        let target = currentScope + '/' + stem + '.json';
        if (reserved.has(target)) {
          stem = 'local_' + deterministicBranchIndexId(currentScope, key);
          target = currentScope + '/' + stem + '.json';
        }
        if (reserved.has(target)) throw userError('errorCleanupNameCollision');
        const data = { ...portableRecord(entry.data, stem === entry.data.sessionId ? undefined : stem, entry.data.title), isArchived: true, isStarred: false };
        imports.push({ path: target, raw: encodeJson(data) });
        const ids = pendingArchive.get(currentScope) ?? new Set<string>();
        ids.add(stem);
        pendingArchive.set(currentScope, ids);
        reserved.add(target);
        broughtBack.add(key);
        action = 'restoreArchived';
      } else if (!currentHasCopy) {
        action = 'trashAfterRestore';
      }
      items.push({ sessionId: key, title: entry.data.title || '', accountId: id,
        oldScope: entry.account.scope, currentHasCopy, action });
      const raw = workspace.snapshot.files.get(entry.path);
      if (!raw || !entry.raw?.equals(raw)) throw userError('errorCleanupSnapshotChanged');
      removals.push({ path: entry.path, raw });
    }
  }
  if (items.length > 5000) throw userError('errorCleanupTooManyCopies');
  const archiveHints: OldCleanupPlan['archiveHints'] = [];
  for (const [scope, names] of pendingArchive) {
    const path = scope + '/archived-sessions.idx';
    const before = workspace.snapshot.files.get(path);
    const data = before ? JSON.parse(before.toString('utf8')) as Record<string, unknown> : { v: 1 };
    if (data.v !== 1 || data.archived !== undefined && (!Array.isArray(data.archived) || data.archived.some((value) => typeof value !== 'string')))
      throw userError('errorCleanupArchiveIndexInvalid');
    const archived = [...new Set([...(data.archived as string[] | undefined ?? []), ...names])].sort();
    archiveHints.push({ path, before, after: encodeJson({ ...data, archived }) });
  }
  const dependencies = captureDependencies(workspace, { accountIds, oldCopies: true });
  for (const addition of imports) dependencies.paths.add(addition.path);
  return { items, removals, imports, archiveHints, accountIds, expectedMain, dependencies };
}

export interface OldCleanupResult {
  trashed: number;
  importedArchived: number;
  mainUnchanged: boolean;
  oldCopiesRemaining: number;
}

// trash must be Electron shell.trashItem, or an isolated fixture's fake Trash.
// It must never unlink: Finder Trash is the recovery path for each old copy.
export async function executeOldCleanup(
  workspace: Workspace, plan: OldCleanupPlan,
  trash: (absolutePath: string) => Promise<void>, guard: () => void,
): Promise<OldCleanupResult> {
  if (!plan.items.length || plan.items.length !== plan.removals.length) throw userError('errorCleanupPlanInvalid');
  const release = acquireFileLock(join(workspace.baseDirectory, '.claudesync.lock'));
  let expected = workspace.snapshot;
  let trashed = 0;
  let importedArchived = 0;
  function check() {
    guard();
    if (!readRegularFile(workspace.configPath).equals(workspace.configRaw)) throw userError('errorCleanupConfigChanged');
    assertDependencySnapshot(expected, takeWorkspaceSnapshot(workspace.root, workspace.accounts), plan.dependencies);
    for (const [id, transcript] of workspace.transcripts) {
      if ('error' in transcript || !plan.dependencies.ids.has(id)) continue;
      try { assertTranscriptCurrent(transcript); }
      catch { throw dependencyError(plan.dependencies, id); }
    }
    const inventory = collectTranscriptIndex(workspace.projectsRoot);
    for (const id of plan.dependencies.ids) {
      if (JSON.stringify(inventory.get(id)) !== JSON.stringify(workspace.transcriptPaths.get(id))) throw dependencyError(plan.dependencies, id);
    }
  }
  try {
    check();
    // All imports must be safely archived before moving any old-only source.
    for (const addition of plan.imports) {
      check();
      if (expected.files.has(addition.path)) throw userError('errorCleanupCurrentNameCollision');
      const target = safeWorkspacePath(workspace.root, addition.path);
      assertPlainDirectory(dirname(target));
      publishNewFile(target, addition.raw);
      expected = snapshotWithAdded(expected, addition.path, addition.raw);
      importedArchived++;
    }
    // Desktop also keeps a native archive index. Save it before removing old sources.
    for (const hint of plan.archiveHints) {
      check();
      const path = safeWorkspacePath(workspace.root, hint.path);
      assertPlainDirectory(dirname(path));
      if (hint.before) {
        replaceRegularFile(path, hint.after, hint.before);
        expected = snapshotWithReplaced(expected, hint.path, hint.after);
      } else {
        publishNewFile(path, hint.after);
        expected = snapshotWithAdded(expected, hint.path, hint.after);
      }
    }
    for (const removal of plan.removals) {
      check();
      const path = safeWorkspacePath(workspace.root, removal.path);
      assertPlainDirectory(dirname(path));
      if (!readRegularFile(path).equals(removal.raw)) throw userError('errorCleanupOldCopyChanged');
      await trash(path);
      expected = snapshotWithRemoved(expected, removal.path);
      trashed++;
    }
    check();
    const fresh = loadWorkspace(workspace.configPath);
    fresh.verifiedOrganizations = workspace.verifiedOrganizations;
    fresh.retiredOrganizationScopes = workspace.retiredOrganizationScopes;
    const updated = buildCatalog(fresh);
    for (const addition of plan.imports) {
      const parts = addition.path.split('/');
      const scope = parts.slice(0, 2).join('/');
      const name = parts[2]!.slice(0, -'.json'.length);
      if (!fresh.archivedByAccount.get(scope)?.has(name)) throw userError('errorCleanupArchiveReadback');
    }
    const mainUnchanged = plan.accountIds.every((id) => updated.accounts.find((a) => a.id === id)?.visible === plan.expectedMain[id]);
    const oldCopiesRemaining = fresh.entries.filter((e) => plan.accountIds.includes(accountIdForScope(e.account.scope))
      && entryGroup(fresh, e) === 'oldOrganization').length;
    if (!mainUnchanged || oldCopiesRemaining !== 0) throw userError('errorCleanupCountMismatch');
    return { trashed, importedArchived, mainUnchanged, oldCopiesRemaining };
  } catch (error) {
    const message = error instanceof Error ? error.message : userMessage('statusCleanupInterrupted');
    throw userError('errorCleanupInterruptedSummary', { message, trashed, importedArchived });
  } finally {
    release();
  }
}
