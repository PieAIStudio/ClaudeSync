import { basename } from 'node:path';
import { accountIdForScope } from './account-identity';
import { sessionKey } from './catalog';
import { historyIds, validateSessionRecord } from './record';
import { sha256, type WorkspaceSnapshot } from './storage';
import { entryGroup } from './visibility';
import type { Workspace } from './workspace';
import type { SessionGroup } from '../shared/contracts';

export interface DataSelection {
  accountIds: string[];
  sessionIds?: string[];
  group?: SessionGroup;
  oldCopies?: boolean;
}
export interface DataDependencies {
  ids: Set<string>;
  paths: Set<string>;
  archivePaths: Set<string>;
  oldOrganizations: Record<string, string>;
  labels: Map<string, string>;
}

export function captureDependencies(workspace: Workspace, selection: DataSelection): DataDependencies {
  const owners = new Set(selection.accountIds), selected = new Set(selection.sessionIds);
  const primary = workspace.entries.filter((entry) => owners.has(accountIdForScope(entry.account.scope))
    && (selection.oldCopies ? entryGroup(workspace, entry) === 'oldOrganization'
      : selected.has(sessionKey(entry)) && (!selection.group || entryGroup(workspace, entry) === selection.group)));
  const selectedKeys = new Set(primary.map(sessionKey));
  const peers = selection.oldCopies ? workspace.entries.filter((entry) => owners.has(accountIdForScope(entry.account.scope))
    && selectedKeys.has(sessionKey(entry))) : [];
  const dependencies: DataDependencies = { ids: new Set(), paths: new Set(), archivePaths: new Set(), labels: new Map(), oldOrganizations: {} };
  for (const entry of [...primary, ...peers]) {
    const label = `${entry.data.title || '未命名会话'}（${sessionKey(entry).slice(0, 8)}）`;
    const ids = [...historyIds(entry.data), entry.data.sessionId.replace(/^local_/u, '')];
    for (const id of ids) { dependencies.ids.add(id); if (!dependencies.labels.has(id)) dependencies.labels.set(id, label); }
    dependencies.paths.add(entry.path); dependencies.labels.set(entry.path, label);
    dependencies.archivePaths.add(entry.account.scope + '/archived-sessions.idx');
  }
  if (selection.oldCopies) for (const id of owners) {
    const organization = workspace.verifiedOrganizations?.[id];
    if (organization) {
      dependencies.oldOrganizations[id] = organization;
      dependencies.archivePaths.add(`${id}/${organization}/archived-sessions.idx`);
    }
  }
  return dependencies;
}

// Unrecognized entries are skipped without following links. The comparison
// ignores unrelated progress, but discovers new recognized relevant references
// in any account, including accounts omitted from the application's settings.
export function dependencySnapshot(snapshot: WorkspaceSnapshot, dependencies?: DataDependencies): WorkspaceSnapshot {
  if (!dependencies) return snapshot;
  const files = new Map<string, Buffer>();
  for (const [path, raw] of snapshot.files) {
    const [owner, organization, name, extra] = path.split('/');
    if (extra || !name) continue;
    let related = dependencies.paths.has(path) || dependencies.archivePaths.has(path);
    if (/^local_[0-9a-f-]{36}\.json$/u.test(name)) {
      const record = validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
      related ||= [...historyIds(record), record.sessionId.slice(6)].some((id) => dependencies.ids.has(id));
      related ||= Boolean(owner && dependencies.oldOrganizations[owner] && organization !== dependencies.oldOrganizations[owner]);
    } else if (name.startsWith('deleted_')) related ||= dependencies.ids.has(name.slice(8));
    if (related) files.set(path, raw);
  }
  return { files, directories: new Map(), skippedPaths: snapshot.skippedPaths };
}

export function dependencyError(dependencies: DataDependencies, changed?: string): Error {
  const id = changed ? basename(changed).replace(/\.jsonl$/u, '') : '';
  const label = dependencies.labels.get(changed ?? '') ?? dependencies.labels.get(id)
    ?? ([...new Set(dependencies.labels.values())].slice(0, 3).join('、') || '所选会话或其共享正文引用');
  return new Error(`Code 会话“${label}”已经变化（检查后索引或正文已变化）；请先保存并关闭这条会话所在的 Claude / Claude Code 窗口，再点“重新检查”后重新选择。`);
}
export function assertDependencySnapshot(expected: WorkspaceSnapshot, actual: WorkspaceSnapshot, dependencies: DataDependencies): void {
  const before = dependencySnapshot(expected, dependencies).files, after = dependencySnapshot(actual, dependencies).files;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (!before.get(path)?.equals(after.get(path) ?? Buffer.alloc(0)) || !after.has(path)) throw dependencyError(dependencies, path);
  }
}

export function selectionRevision(workspace: Workspace, selection: DataSelection): string {
  const dependencies = captureDependencies(workspace, selection);
  return sha256(JSON.stringify({ config: sha256(workspace.configRaw), accounts: workspace.accounts.map((account) => account.scope).sort(),
    organizations: workspace.verifiedOrganizations,
    files: [...dependencySnapshot(workspace.snapshot, dependencies).files].map(([path, raw]) => [path, sha256(raw)]).sort(),
    bodies: [...dependencies.ids].sort().map((id) => [id, workspace.transcripts.get(id), workspace.transcriptPaths.get(id)]),
  }));
}
