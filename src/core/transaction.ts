import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  acquireFileLock, assertPlainDirectory, fileFingerprint, isRecord, publishNewFile, readRegularFile,
  removeRegularFile, replaceRegularFile, safeWorkspacePath, sameSnapshot, sha256,
  snapshotWithAdded, snapshotWithRemoved, snapshotWithReplaced, takeWorkspaceSnapshot, takeDeletionSnapshot,
  assertTranscriptCurrent, removeTranscript, writeOwnedFile,
} from './storage';
import type { TranscriptCheck, WorkspaceSnapshot } from './storage';
import type { Workspace } from './workspace';
import { collectTranscriptIndex } from './workspace';
import { verifiedTargets } from './visibility';
import type { ApplyResult, BackupView, ChangeKind, OperationKind } from '../shared/contracts';

export interface FileChange {
  path: string;
  before?: Buffer;
  after?: Buffer;
  sessionId: string;
  title: string;
  action: ChangeKind;
}

export interface FilePlan {
  blockingReason?: string;
  inputTranscripts?: TranscriptCheck[];
  restoredMarkerPaths?: string[];
  kind: OperationKind;
  changes: FileChange[];
  deletionSnapshot?: WorkspaceSnapshot;
  transcriptRemovals?: TranscriptCheck[];
}

interface Manifest {
  version: 3;
  createdAt: string;
  operation: OperationKind;
  state: 'prepared' | 'verified' | 'interrupted';
  root: string;
  configSha256: string;
  changes: Array<{ path: string; beforeSha256: string | null; afterSha256: string | null; sessionId: string; title: string; action: ChangeKind }>;
  applied: string[];
  error?: string;
}

export function encodeJson<T extends object>(data: T): Buffer {
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function workspaceRevision(workspace: Workspace): string {
  return sha256(JSON.stringify({
    config: sha256(workspace.configRaw),
    scopes: workspace.accounts.map((account) => account.scope).sort(),
    verifiedOrganizations: Object.entries(workspace.verifiedOrganizations ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    files: [...workspace.snapshot.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, raw]) => [path, sha256(raw)]),
    directories: [...workspace.snapshot.directories].sort(([a], [b]) => a.localeCompare(b)),
    transcripts: [...workspace.transcripts].sort(([a], [b]) => a.localeCompare(b)),
    transcriptPaths: [...workspace.transcriptPaths].sort(([a], [b]) => a.localeCompare(b)),
  }));
}

function assertInputsCurrent(workspace: Workspace, removedTranscripts = new Set<string>()): void {
  if (!readRegularFile(workspace.configPath).equals(workspace.configRaw)) throw new Error('设置已改变，请重新检查。');
  for (const transcript of workspace.transcripts.values()) {
    if ('error' in transcript) continue;
    if (removedTranscripts.has(transcript.path)) continue;
    if (JSON.stringify(fileFingerprint(transcript.path)) !== JSON.stringify(transcript.fingerprint)) {
      throw new Error('Code 会话正文在检查后发生变化，请完全退出 Claude 后重新检查。');
    }
  }
}

function createBackup(workspace: Workspace, plan: FilePlan): { path: string; manifest: Manifest } {
  const root = join(workspace.baseDirectory, 'backups');
  if (existsSync(root)) assertPlainDirectory(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assertPlainDirectory(root);
  const path = join(root, `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID()}`);
  mkdirSync(path, { mode: 0o700 });
  for (const change of plan.changes) {
    if (!change.before) continue;
    const destination = safeWorkspacePath(join(path, 'before'), change.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    publishNewFile(destination, change.before);
  }
  const manifest: Manifest = {
    version: 3, createdAt: new Date().toISOString(), operation: plan.kind, state: 'prepared',
    root: workspace.root, configSha256: sha256(workspace.configRaw), applied: [],
    changes: plan.changes.map((change) => ({
      path: change.path, sessionId: change.sessionId, title: change.title, action: change.action,
      beforeSha256: change.before ? sha256(change.before) : null,
      afterSha256: change.after ? sha256(change.after) : null,
    })),
  };
  writeOwnedFile(join(path, 'manifest.json'), encodeJson(manifest));
  return { path, manifest };
}

export function commitFilePlan(workspace: Workspace, plan: FilePlan, guard: () => void): ApplyResult {
  if (plan.blockingReason) throw new Error(plan.blockingReason);
  if (plan.kind === 'sync' || plan.kind === 'keep') {
    const affected = new Set(plan.changes.map((change) => change.path.split('/')[0]));
    const targets = new Set(verifiedTargets(workspace.accounts.filter((account) => affected.has(account.scope.split('/')[0])), workspace.verifiedOrganizations).map((account) => account.scope));
    if (plan.changes.some((change) => !targets.has(change.path.split('/').slice(0, 2).join('/'))
      && !(plan.kind === 'sync' && change.action === 'restore' && !change.after && change.before
        && plan.restoredMarkerPaths?.includes(change.path) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/deleted_[0-9a-f-]{36}$/u.test(change.path))))
      throw new Error('同步计划包含未核实或旧组织目录，已停止。');
  }
  if (plan.changes.length === 0) return { filesChanged: 0, verified: true };
  const paths = new Set<string>();
  for (const change of plan.changes) {
    if (paths.has(change.path)) throw new Error('操作计划包含重复文件。');
    paths.add(change.path);
    const before = workspace.snapshot.files.get(change.path);
    if (before ? !change.before?.equals(before) : Boolean(change.before)) throw new Error('操作计划与检查快照不一致。');
  }
  const release = acquireFileLock(join(workspace.baseDirectory, '.claudesync.lock'));
  let backup: ReturnType<typeof createBackup> | undefined;
  let expected = workspace.snapshot;
  let deletionExpected = plan.deletionSnapshot;
  const removedTranscripts = new Set<string>();
  let applied = 0;
  function checkInputs(): void {
    guard();
    assertInputsCurrent(workspace, removedTranscripts);
    for (const check of plan.inputTranscripts ?? []) assertTranscriptCurrent(check);
    for (const check of plan.transcriptRemovals ?? []) {
      if (!removedTranscripts.has(check.path)) assertTranscriptCurrent(check);
    }
    if (!sameSnapshot(expected, takeWorkspaceSnapshot(workspace.root, workspace.accounts))) throw new Error('检查后Code 会话数据发生变化，已停止修改。请重新检查。');
    if (deletionExpected && !sameSnapshot(deletionExpected, takeDeletionSnapshot(workspace.root))) throw new Error('其他账号的Code 会话发生变化，已停止删除。');
    if (deletionExpected) {
      const inventory = (index: Map<string, string[]>) => [...index].map(([id, paths]) => [id, paths.filter((path) => !removedTranscripts.has(path))] as const)
        .filter(([, paths]) => paths.length).sort(([a], [b]) => a.localeCompare(b));
      if (JSON.stringify(inventory(workspace.transcriptPaths)) !== JSON.stringify(inventory(collectTranscriptIndex(workspace.projectsRoot)))) throw new Error('Code 会话正文目录发生变化，请重新检查。');
    }
  }
  try {
    checkInputs();
    if (plan.kind !== 'delete') backup = createBackup(workspace, plan);
    for (const change of plan.changes) {
      checkInputs();
      const path = safeWorkspacePath(workspace.root, change.path);
      assertPlainDirectory(dirname(path));
      if (change.after) {
        if (change.before) {
          replaceRegularFile(path, change.after, change.before);
          expected = snapshotWithReplaced(expected, change.path, change.after);
          if (deletionExpected) deletionExpected = snapshotWithReplaced(deletionExpected, change.path, change.after);
        } else {
          publishNewFile(path, change.after);
          expected = snapshotWithAdded(expected, change.path, change.after);
          if (deletionExpected) deletionExpected = snapshotWithAdded(deletionExpected, change.path, change.after);
        }
      } else if (change.before) {
        removeRegularFile(path, change.before);
        expected = snapshotWithRemoved(expected, change.path);
        if (deletionExpected) deletionExpected = snapshotWithRemoved(deletionExpected, change.path);
      }
      applied++;
      if (backup) {
        backup.manifest.applied.push(change.path);
        writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest));
      }
    }
    for (const transcript of plan.transcriptRemovals ?? []) {
      if (plan.kind !== 'delete' || !deletionExpected) throw new Error('正文删除计划无效。');
      checkInputs();
      removeTranscript(transcript);
      removedTranscripts.add(transcript.path);
      applied++;
    }
    checkInputs();
    if (backup) {
      backup.manifest.state = 'verified';
      writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest));
    }
    return { filesChanged: applied, verified: true, ...(backup ? { backup: backup.path } : {}) };
  } catch (error) {
    if (backup) {
      backup.manifest.state = 'interrupted';
      backup.manifest.error = error instanceof Error ? error.message : String(error);
      try { writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest)); } catch { /* Preserve the original error. */ }
      throw new Error(`${backup.manifest.error}\n可在“备份与恢复”撤销已完成的部分。备份：${backup.path}`);
    }
    if (plan.kind === 'delete' && applied) throw new Error(`${error instanceof Error ? error.message : '删除中断。'}\n已完成 ${applied} 项文件修改，后续已停止。删除没有备份，无法恢复；请重新检查列表。`);
    throw error;
  } finally {
    release();
  }
}

const BACKUP_ID = /^[0-9TZA-Fa-f-]{30,100}$/u;
const KINDS: readonly OperationKind[] = ['sync', 'keep', 'archive', 'unarchive', 'delete', 'rename', 'star', 'unstar', 'restore'];

function loadManifest(baseDirectory: string, id: string): Manifest {
  if (!BACKUP_ID.test(id)) throw new Error('备份编号无效。');
  const path = join(baseDirectory, 'backups', id);
  assertPlainDirectory(path);
  const value: unknown = JSON.parse(readRegularFile(join(path, 'manifest.json')).toString('utf8'));
  if (!isRecord(value) || value.version !== 3 || typeof value.root !== 'string' || typeof value.configSha256 !== 'string'
    || typeof value.createdAt !== 'string' || !KINDS.includes(value.operation as OperationKind)
    || !['prepared', 'verified', 'interrupted'].includes(String(value.state)) || !Array.isArray(value.changes)) {
    throw new Error('这个备份不是新版可恢复格式。');
  }
  const seen = new Set<string>();
  for (const change of value.changes) {
    if (!isRecord(change) || typeof change.path !== 'string' || typeof change.sessionId !== 'string' || typeof change.title !== 'string'
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:local_[0-9a-f-]{36}\.json|archived-sessions\.idx|deleted_[0-9a-f-]{36})$/u.test(change.path)
      || seen.has(change.path) || ![change.beforeSha256, change.afterSha256].every((hash) => hash === null || typeof hash === 'string' && /^[0-9a-f]{64}$/u.test(hash))) {
      throw new Error('备份清单格式无法安全识别。');
    }
    seen.add(change.path);
  }
  return value as unknown as Manifest;
}

export function listBackups(baseDirectory: string): BackupView[] {
  const root = join(baseDirectory, 'backups');
  if (!existsSync(root)) return [];
  assertPlainDirectory(root);
  return readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory() && BACKUP_ID.test(item.name)).flatMap((item) => {
    try {
      const manifest = loadManifest(baseDirectory, item.name);
      return [{ id: item.name, operation: manifest.operation, state: manifest.state, createdAt: manifest.createdAt, fileCount: manifest.changes.length }];
    } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function buildRestorePlan(workspace: Workspace, id: string): FilePlan {
  const manifest = loadManifest(workspace.baseDirectory, id);
  if (manifest.root !== workspace.root || manifest.configSha256 !== sha256(workspace.configRaw)) throw new Error('备份对应的文件夹或账号设置与现在不同，不能自动恢复。');
  const scopes = new Set(workspace.accounts.map((account) => account.scope));
  const changes: FileChange[] = [];
  for (const change of manifest.changes) {
    const scope = change.path.split('/').slice(0, 2).join('/');
    if (!scopes.has(scope)) throw new Error('备份包含当前设置之外的账号。');
    const current = workspace.snapshot.files.get(change.path);
    const currentHash = current ? sha256(current) : null;
    if (currentHash === change.beforeSha256) continue;
    if (currentHash !== change.afterSha256) throw new Error(`这条Code 会话后来又被修改过，不能覆盖：${change.title || change.sessionId}`);
    let restored: Buffer | undefined;
    if (change.beforeSha256 !== null) {
      const path = safeWorkspacePath(join(workspace.baseDirectory, 'backups', id, 'before'), change.path);
      assertPlainDirectory(dirname(path));
      restored = readRegularFile(path);
      if (sha256(restored) !== change.beforeSha256) throw new Error('备份文件损坏，不能恢复。');
    }
    changes.push({ path: change.path, before: current, after: restored, sessionId: change.sessionId, title: change.title, action: 'restore' });
  }
  return { kind: 'restore', changes };
}
