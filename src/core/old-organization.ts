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
  if (!accountIds.length || accountIds.length > 50) throw new Error('请选择要清理的账号。');
  const expectedMain: Record<string, number> = {};
  const items: OldCopyItemView[] = [];
  const removals: OldCleanupPlan['removals'] = [];
  const imports: OldCleanupPlan['imports'] = [];
  const pendingArchive = new Map<string, Set<string>>();
  const reserved = new Set(workspace.snapshot.files.keys());
  const catalog = buildCatalog(workspace);

  for (const id of accountIds) {
    if (!isUuid(id) || !workspace.accounts.some((account) => accountIdForScope(account.scope) === id))
      throw new Error('选择的账号不在本机清单中。');
    const organization = verifiedOrganization(workspace, id);
    if (!organization) throw new Error('当前组织未核实，不能清理旧副本。请在 Claude Desktop 切到这个账号，再重新检查。');
    const currentScope = id + '/' + organization;
    const scannedPaths = new Set(workspace.entries.map((entry) => entry.path));
    for (const path of workspace.snapshot.files.keys()) {
      const [owner, org, name, extra] = path.split('/');
      if (owner === id && org !== organization && !extra && /^local_[0-9a-f-]{36}\.json$/u.test(name ?? '') && !scannedPaths.has(path))
        throw new Error('旧组织有未列入设置的副本，不能假装已清理完，请先把目录加入检查范围。');
    }
    const count = catalog.accounts.find((account) => account.id === id)?.visible;
    if (count === null || count === undefined) throw new Error('当前组织的主数字未核实。');
    expectedMain[id] = count;
    const inCurrent = new Set(workspace.entries.filter((e) => e.account.scope === currentScope).map(sessionKey));
    const broughtBack = new Set<string>();
    const old = workspace.entries.filter((e) => accountIdForScope(e.account.scope) === id && e.account.scope !== currentScope)
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of old) {
      if (!isUuid(entry.data.cliSessionId) || !isManageable(entry) || hasDeletionMarker(workspace, entry) || entryGroup(workspace, entry) !== 'oldOrganization')
        throw new Error('旧组织里有已删除、定时或无法识别的记录，已停止清理；请先单独核对。');
      const key = sessionKey(entry);
      const currentHasCopy = inCurrent.has(key);
      const hasPlannedImport = broughtBack.has(key);
      let action: OldCopyItemView['action'] = 'trashDuplicate';
      if (!currentHasCopy && !hasPlannedImport) {
        if (entry.syncIssue) throw new Error('有旧会话缺少正文或无法安全复制，已停止；所有旧副本均未移动。');
        let stem = entry.data.sessionId;
        let target = currentScope + '/' + stem + '.json';
        if (reserved.has(target)) {
          stem = 'local_' + deterministicBranchIndexId(currentScope, key);
          target = currentScope + '/' + stem + '.json';
        }
        if (reserved.has(target)) throw new Error('当前组织里有重名文件，已停止以免覆盖。');
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
      if (!raw || !entry.raw?.equals(raw)) throw new Error('旧会话快照无法核实，已停止。');
      removals.push({ path: entry.path, raw });
    }
  }
  if (items.length > 5000) throw new Error('本次旧副本过多，请分账号清理。');
  const archiveHints: OldCleanupPlan['archiveHints'] = [];
  for (const [scope, names] of pendingArchive) {
    const path = scope + '/archived-sessions.idx';
    const before = workspace.snapshot.files.get(path);
    const data = before ? JSON.parse(before.toString('utf8')) as Record<string, unknown> : { v: 1 };
    if (data.v !== 1 || data.archived !== undefined && (!Array.isArray(data.archived) || data.archived.some((value) => typeof value !== 'string')))
      throw new Error('当前组织归档索引格式无法识别。');
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
  if (!plan.items.length || plan.items.length !== plan.removals.length) throw new Error('清理清单为空或无效。');
  const release = acquireFileLock(join(workspace.baseDirectory, '.claudesync.lock'));
  let expected = workspace.snapshot;
  let trashed = 0;
  let importedArchived = 0;
  function check() {
    guard();
    if (!readRegularFile(workspace.configPath).equals(workspace.configRaw)) throw new Error('设置已变化，已停止清理。');
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
      if (expected.files.has(addition.path)) throw new Error('当前组织已有同名文件。');
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
      if (!readRegularFile(path).equals(removal.raw)) throw new Error('旧副本在预览后变化。');
      await trash(path);
      expected = snapshotWithRemoved(expected, removal.path);
      trashed++;
    }
    check();
    const fresh = loadWorkspace(workspace.configPath);
    fresh.verifiedOrganizations = workspace.verifiedOrganizations;
    const updated = buildCatalog(fresh);
    for (const addition of plan.imports) {
      const parts = addition.path.split('/');
      const scope = parts.slice(0, 2).join('/');
      const name = parts[2]!.slice(0, -'.json'.length);
      if (!fresh.archivedByAccount.get(scope)?.has(name)) throw new Error('归档索引读回失败。');
    }
    const mainUnchanged = plan.accountIds.every((id) => updated.accounts.find((a) => a.id === id)?.visible === plan.expectedMain[id]);
    const oldCopiesRemaining = fresh.entries.filter((e) => plan.accountIds.includes(accountIdForScope(e.account.scope))
      && e.account.scope !== idScope(fresh, accountIdForScope(e.account.scope))).length;
    if (!mainUnchanged || oldCopiesRemaining !== 0) throw new Error('读回数字不符合预期，请检查记录。');
    return { trashed, importedArchived, mainUnchanged, oldCopiesRemaining };
  } catch (error) {
    const message = error instanceof Error ? error.message : '清理中断';
    throw new Error(message + '；已移入废纸篓 ' + trashed + ' 条、已归档搬回 ' + importedArchived + ' 条。未自动重试，请重新检查；废纸篓中的旧副本可恢复。');
  } finally {
    release();
  }
}
function idScope(workspace: Workspace, id: string): string | undefined {
  const org = verifiedOrganization(workspace, id);
  return org ? id + '/' + org : undefined;
}
