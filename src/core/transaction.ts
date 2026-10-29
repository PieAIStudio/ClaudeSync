import { assertDependencySnapshot, dependencyError, type DataDependencies } from './data-scope';
import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  acquireFileLock, assertPlainDirectory, isRecord, publishNewFile, readRegularFile,
  removeRegularFile, replaceRegularFile, safeWorkspacePath, sameSnapshot, sha256,
  snapshotWithAdded, snapshotWithRemoved, snapshotWithReplaced, takeWorkspaceSnapshot, takeDeletionSnapshot,
  assertTranscriptCurrent, removeTranscript, writeOwnedFile,
} from './storage';
import type { TranscriptCheck, WorkspaceSnapshot } from './storage';
import type { Workspace } from './workspace';
import { collectTranscriptIndex } from './workspace';
import { verifiedTargets } from './visibility';
import type { ApplyResult, BackupView, ChangeKind, OperationKind } from '../shared/contracts';
import { userError, userMessage } from '../error-copy';

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
  dependencies?: DataDependencies;
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

function assertInputsCurrent(workspace: Workspace, removedTranscripts = new Set<string>(), dependencies?: DataDependencies): void {
  if (!readRegularFile(workspace.configPath).equals(workspace.configRaw)) throw userError('errorConfigChanged');
  for (const [id, transcript] of workspace.transcripts) {
    if ('error' in transcript || dependencies && !dependencies.ids.has(id) || removedTranscripts.has(transcript.path)) continue;
    try { assertTranscriptCurrent(transcript); }
    catch { throw dependencies ? dependencyError(dependencies, id) : userError('errorTranscriptChangedAfterCheck'); }
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

interface CommitState {
  expected: WorkspaceSnapshot;
  deletionExpected?: WorkspaceSnapshot;
  removedTranscripts: Set<string>;
  applied: number;
}

function assertPlanTargets(workspace: Workspace, plan: FilePlan): void {
  if (plan.blockingReason) throw new Error(plan.blockingReason);
  if (plan.kind !== 'sync' && plan.kind !== 'keep') return;
  const affected = new Set(plan.changes.map((change) => change.path.split('/')[0]));
  const targets = new Set(verifiedTargets(workspace.accounts.filter((account) => affected.has(account.scope.split('/')[0])), workspace.verifiedOrganizations).map((account) => account.scope));
  const safeMarkers = (change: FileChange) => plan.kind === 'sync' && change.action === 'restore' && !change.after && Boolean(change.before)
    && Boolean(plan.restoredMarkerPaths?.includes(change.path)) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/deleted_[0-9a-f-]{36}$/u.test(change.path);
  if (plan.changes.some((change) => !targets.has(change.path.split('/').slice(0, 2).join('/')) && !safeMarkers(change))) throw userError('errorUnverifiedPlan');
}

function assertPlanPaths(workspace: Workspace, plan: FilePlan): void {
  const paths = new Set<string>();
  for (const change of plan.changes) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:local_[0-9a-f-]{36}\.json|archived-sessions\.idx|deleted_[0-9a-f-]{36})$/u.test(change.path)) throw userError('errorUnmanagedPath');
    if (paths.has(change.path)) throw userError('errorDuplicatePlanPath');
    paths.add(change.path);
    const before = workspace.snapshot.files.get(change.path);
    if (before ? !change.before?.equals(before) : Boolean(change.before)) throw userError('errorPlanSnapshotMismatch');
  }
}

function assertCommitInputs(workspace: Workspace, plan: FilePlan, state: CommitState, guard: () => void): void {
  guard();
  assertInputsCurrent(workspace, state.removedTranscripts, plan.dependencies);
  for (const check of plan.inputTranscripts ?? []) assertTranscriptCurrent(check);
  for (const check of plan.transcriptRemovals ?? []) if (!state.removedTranscripts.has(check.path)) assertTranscriptCurrent(check);
  const current = takeWorkspaceSnapshot(workspace.root, workspace.accounts);
  if (plan.dependencies) assertDependencySnapshot(state.expected, current, plan.dependencies);
  else if (!sameSnapshot(state.expected, current)) throw userError('errorWorkspaceChanged');
  if (state.deletionExpected) {
    const allAccounts = takeDeletionSnapshot(workspace.root);
    if (plan.dependencies) assertDependencySnapshot(state.deletionExpected, allAccounts, plan.dependencies);
    else if (!sameSnapshot(state.deletionExpected, allAccounts)) throw userError('errorOtherAccountChanged');
  }
  for (const change of plan.changes) {
    const target = safeWorkspacePath(workspace.root, change.path);
    assertPlainDirectory(dirname(target));
    if (state.expected.files.has(change.path)) continue;
    try { lstatSync(target); }
    catch (error) { if (isRecord(error) && error.code === 'ENOENT') continue; throw error; }
    throw userError('errorUnrecognizedTarget', { path: change.path });
  }
  if (state.deletionExpected) {
    const inventory = (index: Map<string, string[]>) => [...index].filter(([id]) => !plan.dependencies || plan.dependencies.ids.has(id)).map(([id, paths]) => [id, paths.filter((path) => !state.removedTranscripts.has(path))] as const)
      .filter(([, paths]) => paths.length).sort(([a], [b]) => a.localeCompare(b));
    if (JSON.stringify(inventory(workspace.transcriptPaths)) !== JSON.stringify(inventory(collectTranscriptIndex(workspace.projectsRoot)))) throw userError('errorTranscriptDirectoryChanged');
  }
}

function applyPlanChanges(workspace: Workspace, plan: FilePlan, state: CommitState, backup: ReturnType<typeof createBackup> | undefined, checkInputs: () => void): void {
  for (const change of plan.changes) {
    checkInputs();
    const path = safeWorkspacePath(workspace.root, change.path);
    assertPlainDirectory(dirname(path));
    if (change.after) {
      if (change.before) {
        replaceRegularFile(path, change.after, change.before);
        state.expected = snapshotWithReplaced(state.expected, change.path, change.after);
        if (state.deletionExpected) state.deletionExpected = snapshotWithReplaced(state.deletionExpected, change.path, change.after);
      } else {
        publishNewFile(path, change.after);
        state.expected = snapshotWithAdded(state.expected, change.path, change.after);
        if (state.deletionExpected) state.deletionExpected = snapshotWithAdded(state.deletionExpected, change.path, change.after);
      }
    } else if (change.before) {
      removeRegularFile(path, change.before);
      state.expected = snapshotWithRemoved(state.expected, change.path);
      if (state.deletionExpected) state.deletionExpected = snapshotWithRemoved(state.deletionExpected, change.path);
    }
    state.applied++;
    if (backup) {
      backup.manifest.applied.push(change.path);
      writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest));
    }
  }
  for (const transcript of plan.transcriptRemovals ?? []) {
    if (plan.kind !== 'delete' || !state.deletionExpected) throw userError('errorInvalidDeletePlan');
    checkInputs();
    // Unknown stores may hold references we cannot inspect. Delete recognized
    // indexes normally, but retain shared bodies rather than guessing ownership.
    if (takeDeletionSnapshot(workspace.root).skippedPaths.length) continue;
    removeTranscript(transcript);
    state.removedTranscripts.add(transcript.path);
    state.applied++;
  }
}

export function commitFilePlan(workspace: Workspace, plan: FilePlan, guard: () => void): ApplyResult {
  assertPlanTargets(workspace, plan);
  if (plan.changes.length === 0) return { filesChanged: 0, verified: true };
  assertPlanPaths(workspace, plan);
  const release = acquireFileLock(join(workspace.baseDirectory, '.claudesync.lock'));
  const state: CommitState = { expected: workspace.snapshot, deletionExpected: plan.deletionSnapshot, removedTranscripts: new Set(), applied: 0 };
  let backup: ReturnType<typeof createBackup> | undefined;
  const checkInputs = () => assertCommitInputs(workspace, plan, state, guard);
  try {
    checkInputs();
    if (plan.kind !== 'delete') backup = createBackup(workspace, plan);
    applyPlanChanges(workspace, plan, state, backup, checkInputs);
    checkInputs();
    if (backup) {
      backup.manifest.state = 'verified';
      writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest));
    }
    return { filesChanged: state.applied, verified: true, ...(backup ? { backup: backup.path } : {}) };
  } catch (error) {
    if (backup) {
      backup.manifest.state = 'interrupted';
      backup.manifest.error = error instanceof Error ? error.message : String(error);
      try { writeOwnedFile(join(backup.path, 'manifest.json'), encodeJson(backup.manifest)); } catch { /* Preserve the original error. */ }
      throw userError('errorBackupInterrupted', { message: backup.manifest.error ?? userMessage('statusDeleteInterrupted'), path: backup.path });
    }
    if (plan.kind === 'delete' && state.applied) throw userError('errorDeleteInterrupted', { message: error instanceof Error ? error.message : userMessage('statusDeleteInterrupted'), applied: state.applied });
    throw error;
  } finally {
    release();
  }
}

const BACKUP_ID = /^[0-9TZA-Fa-f-]{30,100}$/u;
const KINDS: readonly OperationKind[] = ['sync', 'keep', 'archive', 'unarchive', 'delete', 'rename', 'star', 'unstar', 'restore'];

function loadManifest(baseDirectory: string, id: string): Manifest {
  if (!BACKUP_ID.test(id)) throw userError('errorInvalidBackupId');
  const path = join(baseDirectory, 'backups', id);
  assertPlainDirectory(path);
  const value: unknown = JSON.parse(readRegularFile(join(path, 'manifest.json')).toString('utf8'));
  if (!isRecord(value) || value.version !== 3 || typeof value.root !== 'string' || typeof value.configSha256 !== 'string'
    || typeof value.createdAt !== 'string' || !KINDS.includes(value.operation as OperationKind)
    || !['prepared', 'verified', 'interrupted'].includes(String(value.state)) || !Array.isArray(value.changes)) {
    throw userError('errorBackupFormat');
  }
  const seen = new Set<string>();
  for (const change of value.changes) {
    if (!isRecord(change) || typeof change.path !== 'string' || typeof change.sessionId !== 'string' || typeof change.title !== 'string'
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:local_[0-9a-f-]{36}\.json|archived-sessions\.idx|deleted_[0-9a-f-]{36})$/u.test(change.path)
      || seen.has(change.path) || ![change.beforeSha256, change.afterSha256].every((hash) => hash === null || typeof hash === 'string' && /^[0-9a-f]{64}$/u.test(hash))) {
      throw userError('errorBackupManifest');
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
  if (manifest.root !== workspace.root || manifest.configSha256 !== sha256(workspace.configRaw)) throw userError('errorRestoreWorkspaceMismatch');
  const scopes = new Set(workspace.accounts.map((account) => account.scope));
  const changes: FileChange[] = [];
  for (const change of manifest.changes) {
    const scope = change.path.split('/').slice(0, 2).join('/');
    if (!scopes.has(scope)) throw userError('errorRestoreScope');
    const current = workspace.snapshot.files.get(change.path);
    const currentHash = current ? sha256(current) : null;
    if (currentHash === change.beforeSha256) continue;
    if (currentHash !== change.afterSha256) throw userError('errorRestoreSessionChanged', { title: change.title || change.sessionId });
    let restored: Buffer | undefined;
    if (change.beforeSha256 !== null) {
      const path = safeWorkspacePath(join(workspace.baseDirectory, 'backups', id, 'before'), change.path);
      assertPlainDirectory(dirname(path));
      restored = readRegularFile(path);
      if (sha256(restored) !== change.beforeSha256) throw userError('errorBackupCorrupt');
    }
    changes.push({ path: change.path, before: current, after: restored, sessionId: change.sessionId, title: change.title, action: 'restore' });
  }
  return { kind: 'restore', changes };
}
