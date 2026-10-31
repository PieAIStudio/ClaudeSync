import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { uptime } from 'node:os';
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Account } from './types';
import { validateSessionRecord } from './record';
import { userError } from '../error-copy';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export const MAX_INDEX_BYTES = 10 * 1024 * 1024;
const MAX_BACKLOG_BYTES = 32 * 1024 * 1024;
const SAMPLE_BYTES = 1024 * 1024;

interface FileFingerprint {
  device: string;
  inode: string;
  bytes: string;
  modifiedNs: string;
}

export interface WorkspaceSnapshot {
  files: Map<string, Buffer>;
  directories: Map<string, string[]>;
  skippedPaths: string[];
}

export interface TranscriptCheck {
  path: string;
  bytes: number;
  fingerprint: FileFingerprint;
  summaryAtStart: boolean;
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readRegularFile(path: string, limit = MAX_INDEX_BYTES): Buffer {
  const info = lstatSync(path);
  if (!info.isFile()) throw userError('errorNotRegularFile', { path });
  if (info.size > limit) throw userError('errorFileTooLarge', { path });
  const raw = readFileSync(path);
  if (raw.length !== info.size) throw userError('errorFileSizeChanged', { path });
  return raw;
}

export function assertPlainDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || realpathSync(path) !== resolve(path)) {
    throw userError('errorDirectoryInvalid', { path });
  }
}

function fileFingerprint(path: string): FileFingerprint {
  const info = statSync(path, { bigint: true });
  return {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    bytes: info.size.toString(),
    modifiedNs: info.mtimeNs.toString(),
  };
}

export function inspectTranscript(path: string): TranscriptCheck {
  if (realpathSync(path) !== resolve(path)) throw userError('errorTranscriptSymlink');
  const linkInfo = lstatSync(path);
  if (!linkInfo.isFile() || linkInfo.size === 0) throw userError('errorTranscriptEmpty');
  const before = fileFingerprint(path);
  const fd = openSync(path, 'r');
  let prefix: Buffer;
  let tail: Buffer;
  try {
    const openedInfo = fstatSync(fd, { bigint: true });
    if (openedInfo.dev.toString() !== before.device || openedInfo.ino.toString() !== before.inode) {
      throw userError('errorTranscriptReplaced');
    }
    const prefixLength = Math.min(SAMPLE_BYTES, Number(openedInfo.size));
    prefix = Buffer.alloc(prefixLength);
    readSync(fd, prefix, 0, prefixLength, 0);
    const tailLength = Math.min(SAMPLE_BYTES, Number(openedInfo.size));
    tail = Buffer.alloc(tailLength);
    readSync(fd, tail, 0, tailLength, Number(openedInfo.size) - tailLength);
  } finally {
    closeSync(fd);
  }
  const lines = prefix!.toString('utf8').split(/\r?\n/u);
  if (BigInt(before.bytes) > BigInt(SAMPLE_BYTES) && !prefix!.toString('utf8').endsWith('\n')) lines.pop();
  const parsed: Record<string, unknown>[] = [];
  for (const line of lines.filter(Boolean).slice(0, 32)) {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) throw userError('errorJsonlHeaderInvalid');
    parsed.push(value);
  }
  if (parsed.length === 0) throw userError('errorJsonlHeaderEmpty');
  const tailText = tail!.toString('utf8').replace(/[\r\n]+$/u, '');
  const ending = tailText.slice(tailText.lastIndexOf('\n') + 1);
  if (BigInt(before.bytes) <= BigInt(SAMPLE_BYTES) || tailText.includes('\n')) {
    if (!isRecord(JSON.parse(ending))) throw userError('errorJsonlTailInvalid');
  } else {
    throw userError('errorJsonlLastLineTooLarge');
  }
  let summaryAtStart = false;
  for (const row of parsed) {
    if (row.type !== 'user') continue;
    const message = isRecord(row.message) ? row.message : {};
    let content = message.content;
    if (Array.isArray(content)) {
      content = content
        .filter((part): part is Record<string, unknown> => isRecord(part) && typeof part.text === 'string')
        .map((part) => part.text)
        .join(' ');
    }
    if (typeof content === 'string' && content.length > 0) {
      summaryAtStart = Boolean(row.isCompactSummary)
        || content.includes('This session is being continued from a previous');
      break;
    }
  }
  const after = fileFingerprint(path);
  if (!sameFingerprint(before, after)) throw userError('errorTranscriptChanging');
  return { path, bytes: Number(before.bytes), fingerprint: before, summaryAtStart };
}

export function takeWorkspaceSnapshot(root: string, accounts: Account[]): WorkspaceSnapshot {
  assertPlainDirectory(root);
  const files = new Map<string, Buffer>();
  const directories = new Map<string, string[]>();
  const skipped = new Set<string>();
  function members(path: string): string[] | undefined {
    try {
      assertPlainDirectory(join(root, path));
      return readdirSync(join(root, path)).sort();
    } catch { skipped.add(path); return undefined; }
  }
  function retain(path: string, limit = MAX_INDEX_BYTES, validate?: (raw: Buffer) => void): boolean {
    try {
      const raw = readRegularFile(join(root, path), limit);
      validate?.(raw);
      files.set(path, raw);
      return true;
    } catch { skipped.add(path); return false; }
  }
  // Inspect names/types only: never follow an unknown login's link or recurse
  // into an unrecognized store. Configured write targets are checked separately.
  for (const name of readdirSync(root).sort()) {
    try {
      if (!UUID.test(name)) skipped.add(name);
      else assertPlainDirectory(join(root, name));
    } catch { skipped.add(name); }
  }
  const organizations = [...new Set(accounts.map((account) => account.scope.split('/')[0]))].sort();
  for (const organization of organizations) {
    if (!UUID.test(organization)) throw userError('errorOrganizationDirectoryInvalid', { organization });
    const accountsInOrganization = members(organization);
    if (!accountsInOrganization) continue;
    const plainAccounts: string[] = [];
    directories.set(organization, plainAccounts);
    for (const accountName of accountsInOrganization) {
      const scope = `${organization}/${accountName}`;
      if (!UUID.test(accountName)) { skipped.add(scope); continue; }
      const names = members(scope);
      if (!names) continue;
      plainAccounts.push(accountName);
      const retained: string[] = [];
      directories.set(scope, retained);
      for (const name of names) {
        const path = `${scope}/${name}`;
        if (name === 'backlog' || name === 'waiting-input') {
          // Desktop owns these auxiliary stores. Snapshot regular bytes only;
          // neither their contents nor skipped entries become chat records.
          const children = members(path);
          if (!children) continue;
          retained.push(name);
          const plainChildren: string[] = [];
          directories.set(path, plainChildren);
          for (const child of children) {
            const childPath = `${path}/${child}`;
            if (name === 'backlog' && child !== 'tasks.json') { skipped.add(childPath); continue; }
            if (retain(childPath, name === 'backlog' ? MAX_BACKLOG_BYTES : MAX_INDEX_BYTES)) plainChildren.push(child);
          }
          continue;
        }
        if (!/^(?:local_[0-9a-f-]{36}\.json|deleted_[0-9a-f-]{36}|archived-sessions\.idx|scheduled-tasks\.json)$/u.test(name)) {
          skipped.add(path);
          continue;
        }
        if (retain(path, MAX_INDEX_BYTES, (raw) => {
          if (name.startsWith('local_')) validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
          if (name === 'archived-sessions.idx') {
            const value: unknown = JSON.parse(raw.toString('utf8'));
            if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.archived)
              || value.archived.some((id) => typeof id !== 'string')) throw userError('errorArchiveIndexInvalid');
          }
        })) retained.push(name);
      }
    }
  }
  return { files, directories, skippedPaths: [...skipped].sort() };
}

// Deleting an exclusive transcript must account for logins omitted from tool settings.
export function takeDeletionSnapshot(root: string): WorkspaceSnapshot {
  assertPlainDirectory(root);
  const names = readdirSync(root).sort().filter((name) => UUID.test(name));
  const accounts: Account[] = names.map((id) => ({ label: id, scope: `${id}/${id}` }));
  const snapshot = takeWorkspaceSnapshot(root, accounts);
  snapshot.directories.set('', names.filter((id) => snapshot.directories.has(id)));
  return snapshot;
}

export function assertTranscriptCurrent(check: TranscriptCheck): void {
  assertPlainDirectory(dirname(check.path));
  if (realpathSync(check.path) !== resolve(check.path) || !lstatSync(check.path).isFile()
    || !sameFingerprint(fileFingerprint(check.path), check.fingerprint)) throw userError('errorTranscriptChangedBeforeDelete');
}

export function removeTranscript(check: TranscriptCheck): void {
  assertTranscriptCurrent(check);
  unlinkSync(check.path);
  syncDirectory(dirname(check.path));
}

export function sameSnapshot(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  if (left.files.size !== right.files.size || left.directories.size !== right.directories.size) return false;
  for (const [path, raw] of left.files) {
    const candidate = right.files.get(path);
    if (!candidate || !raw.equals(candidate)) return false;
  }
  for (const [path, names] of left.directories) {
    const candidate = right.directories.get(path);
    if (!candidate || names.length !== candidate.length || names.some((name, index) => name !== candidate[index])) return false;
  }
  return true;
}

export function safeWorkspacePath(root: string, relativePath: string): string {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  const escaped = relative(base, target);
  if (escaped.startsWith('..') || isAbsolute(escaped)) throw userError('errorPathOutsideWorkspace', { relativePath });
  return target;
}

export function snapshotWithAdded(snapshot: WorkspaceSnapshot, relativePath: string, raw: Buffer): WorkspaceSnapshot {
  const files = new Map(snapshot.files);
  files.set(relativePath, raw);
  const directories = new Map(snapshot.directories);
  const parent = dirname(relativePath).replaceAll('\\', '/');
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const members = directories.get(parent);
  if (!members) throw userError('errorTargetDirectoryMissingSnapshot', { parent });
  directories.set(parent, [...members, name].sort());
  return { ...snapshot, files, directories };
}

export function snapshotWithReplaced(snapshot: WorkspaceSnapshot, relativePath: string, raw: Buffer): WorkspaceSnapshot {
  if (!snapshot.files.has(relativePath)) throw userError('errorSnapshotMissingTitleTarget', { relativePath });
  const files = new Map(snapshot.files);
  files.set(relativePath, raw);
  return { ...snapshot, files, directories: new Map(snapshot.directories) };
}

export function snapshotWithRemoved(snapshot: WorkspaceSnapshot, relativePath: string): WorkspaceSnapshot {
  if (!snapshot.files.has(relativePath)) throw userError('errorSnapshotMissingRemovalTarget', { relativePath });
  const files = new Map(snapshot.files);
  files.delete(relativePath);
  const directories = new Map(snapshot.directories);
  const parent = dirname(relativePath).replaceAll('\\', '/');
  directories.set(parent, (directories.get(parent) ?? []).filter((name) => name !== basename(relativePath)));
  return { ...snapshot, files, directories };
}

export function removeRegularFile(path: string, expected: Buffer): void {
  if (!readRegularFile(path).equals(expected)) throw userError('errorRemovalFileChanged', { path });
  unlinkSync(path);
  syncDirectory(dirname(path));
}

export function publishNewFile(path: string, raw: Buffer): void {
  const temporary = join(dirname(path), `.claudesync-${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  syncDirectory(dirname(path));
}

export function replaceRegularFile(path: string, raw: Buffer, expected: Buffer): void {
  const before = readRegularFile(path);
  if (!before.equals(expected)) throw userError('errorTitleTargetChanged', { path });
  const permissions = lstatSync(path).mode & 0o777;
  const temporary = join(dirname(path), `.claudesync-${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temporary, permissions);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  syncDirectory(dirname(path));
}

export function writeOwnedFile(path: string, raw: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.claudesync-${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  syncDirectory(dirname(path));
}

function lockOwnerRunning(pid: number, modifiedMs: number): boolean {
  if (modifiedMs < Date.now() - uptime() * 1000) return false;
  try { process.kill(pid, 0); }
  catch (error) {
    if (isRecord(error) && error.code === 'ESRCH') return false;
    throw userError('errorLockOwnerUnavailable');
  }
  if (pid === process.pid) return true;
  let command: string;
  try {
    command = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`], { encoding: 'utf8', timeout: 5000, windowsHide: true })
      : execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm=', '-o', 'args='], { encoding: 'utf8', timeout: 3000 });
  } catch (error) {
    if (isRecord(error) && error.status === 1) return false; // The owner exited during inspection.
    throw userError('errorLockOwnerUnavailable');
  }
  return /(?:^|[/\\\s])claudesync(?:\.app|\.exe)?(?:[/\\\s]|$)/iu.test(command);
}

export function acquireFileLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const before = lstatSync(path);
    const raw = readRegularFile(path, 64);
    const value = raw.toString('utf8').trim();
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw userError('errorLockInvalid');
    if (lockOwnerRunning(Number(value), before.mtimeMs)) throw userError('errorOperationAlreadyRunning');
    const now = lstatSync(path);
    if (now.dev !== before.dev || now.ino !== before.ino || !readRegularFile(path, 64).equals(raw)) throw userError('errorLockChanged');
    unlinkSync(path);
  }
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, `${process.pid}\n`);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(path);
    throw error;
  }
  return () => {
    closeSync(fd);
    unlinkSync(path);
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.device === right.device && left.inode === right.inode
    && left.bytes === right.bytes && left.modifiedNs === right.modifiedNs;
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
