import { createHash, randomBytes } from 'node:crypto';
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

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export const MAX_INDEX_BYTES = 10 * 1024 * 1024;
const MAX_BACKLOG_BYTES = 32 * 1024 * 1024;
const SAMPLE_BYTES = 1024 * 1024;

export interface FileFingerprint {
  device: string;
  inode: string;
  bytes: string;
  modifiedNs: string;
}

export interface WorkspaceSnapshot {
  files: Map<string, Buffer>;
  directories: Map<string, string[]>;
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
  if (!info.isFile()) throw new Error(`不是普通文件，停止读取：${path}`);
  if (info.size > limit) throw new Error(`文件超过检查上限，停止读取：${path}`);
  const raw = readFileSync(path);
  if (raw.length !== info.size) throw new Error(`读取期间文件大小发生变化：${path}`);
  return raw;
}

export function assertPlainDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || realpathSync(path) !== resolve(path)) {
    throw new Error(`目录不存在或包含符号链接：${path}`);
  }
}

export function fileFingerprint(path: string): FileFingerprint {
  const info = statSync(path, { bigint: true });
  return {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    bytes: info.size.toString(),
    modifiedNs: info.mtimeNs.toString(),
  };
}

export function inspectTranscript(path: string): TranscriptCheck {
  if (realpathSync(path) !== resolve(path)) throw new Error('正文路径包含符号链接');
  const linkInfo = lstatSync(path);
  if (!linkInfo.isFile() || linkInfo.size === 0) throw new Error('正文文件为空或不是普通文件');
  const before = fileFingerprint(path);
  const fd = openSync(path, 'r');
  let prefix: Buffer;
  let tail: Buffer;
  try {
    const openedInfo = fstatSync(fd, { bigint: true });
    if (openedInfo.dev.toString() !== before.device || openedInfo.ino.toString() !== before.inode) {
      throw new Error('正文在检查期间被替换');
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
    if (!isRecord(value)) throw new Error('JSONL 首部格式错误');
    parsed.push(value);
  }
  if (parsed.length === 0) throw new Error('JSONL 首部为空或格式错误');
  const tailText = tail!.toString('utf8').replace(/[\r\n]+$/u, '');
  const ending = tailText.slice(tailText.lastIndexOf('\n') + 1);
  if (BigInt(before.bytes) <= BigInt(SAMPLE_BYTES) || tailText.includes('\n')) {
    if (!isRecord(JSON.parse(ending))) throw new Error('JSONL 尾部格式错误');
  } else {
    throw new Error('最后一行超过检查上限，无法可靠识别正文');
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
  if (!sameFingerprint(before, after)) throw new Error('正文正在变化；完全退出 Claude/Code 后重试');
  return { path, bytes: Number(before.bytes), fingerprint: before, summaryAtStart };
}

export function takeWorkspaceSnapshot(root: string, accounts: Account[]): WorkspaceSnapshot {
  assertPlainDirectory(root);
  const files = new Map<string, Buffer>();
  const directories = new Map<string, string[]>();
  const organizations = [...new Set(accounts.map((account) => account.scope.split('/')[0]))].sort();
  for (const organization of organizations) {
    if (!UUID.test(organization)) throw new Error(`账号目录格式错误：${organization}`);
    const organizationPath = join(root, organization);
    assertPlainDirectory(organizationPath);
    const accountsInOrganization = readdirSync(organizationPath).sort();
    directories.set(organization, accountsInOrganization);
    for (const accountName of accountsInOrganization) {
      if (!UUID.test(accountName)) throw new Error(`出现未知账号目录结构：${join(organizationPath, accountName)}`);
      const accountPath = join(organizationPath, accountName);
      assertPlainDirectory(accountPath);
      const members = readdirSync(accountPath).sort();
      directories.set(`${organization}/${accountName}`, members);
      for (const name of members) {
        const path = join(accountPath, name);
        const relativePath = `${organization}/${accountName}/${name}`;
        const info = lstatSync(path);
        if (name === 'backlog') {
          // Claude Desktop keeps task suggestions here, outside the chat indexes.
          // Retain their bytes in the transaction snapshot without managing them.
          assertPlainDirectory(path);
          const backlogMembers = readdirSync(path).sort();
          directories.set(relativePath, backlogMembers);
          for (const member of backlogMembers) {
            if (member !== 'tasks.json') throw new Error(`出现未知的 Claude 待办目录结构：${relativePath}/${member}`);
            files.set(`${relativePath}/${member}`, readRegularFile(join(path, member), MAX_BACKLOG_BYTES));
          }
          continue;
        }
        if (!info.isFile()) throw new Error(`账号目录中存在非普通文件：${relativePath}`);
        files.set(relativePath, readRegularFile(path));
      }
    }
  }
  return { files, directories };
}

// Deleting an exclusive transcript must account for logins omitted from tool settings.
export function takeDeletionSnapshot(root: string): WorkspaceSnapshot {
  assertPlainDirectory(root);
  const names = readdirSync(root).sort();
  const accounts: Account[] = names.map((id) => {
    if (!UUID.test(id)) throw new Error('Code 会话目录中出现未知账号结构，暂不能删除正文。');
    const path = join(root, id);
    assertPlainDirectory(path);
    const orgs = readdirSync(path).sort();
    if (!orgs.length) return { label: id, scope: `${id}/${id}` };
    return { label: id, scope: `${id}/${orgs[0]}` };
  });
  const snapshot = takeWorkspaceSnapshot(root, accounts);
  snapshot.directories.set('', names);
  return snapshot;
}

export function assertTranscriptCurrent(check: TranscriptCheck): void {
  assertPlainDirectory(dirname(check.path));
  if (realpathSync(check.path) !== resolve(check.path) || !lstatSync(check.path).isFile()
    || !sameFingerprint(fileFingerprint(check.path), check.fingerprint)) throw new Error('Code 会话正文在删除前发生变化，请重新检查。');
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
  if (escaped.startsWith('..') || isAbsolute(escaped)) throw new Error(`路径超出会话目录：${relativePath}`);
  return target;
}

export function snapshotWithAdded(snapshot: WorkspaceSnapshot, relativePath: string, raw: Buffer): WorkspaceSnapshot {
  const files = new Map(snapshot.files);
  files.set(relativePath, raw);
  const directories = new Map(snapshot.directories);
  const parent = dirname(relativePath).replaceAll('\\', '/');
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const members = directories.get(parent);
  if (!members) throw new Error(`目标账号目录不在扫描快照中：${parent}`);
  directories.set(parent, [...members, name].sort());
  return { files, directories };
}

export function snapshotWithReplaced(snapshot: WorkspaceSnapshot, relativePath: string, raw: Buffer): WorkspaceSnapshot {
  if (!snapshot.files.has(relativePath)) throw new Error(`快照中没有标题目标：${relativePath}`);
  const files = new Map(snapshot.files);
  files.set(relativePath, raw);
  return { files, directories: new Map(snapshot.directories) };
}

export function snapshotWithRemoved(snapshot: WorkspaceSnapshot, relativePath: string): WorkspaceSnapshot {
  if (!snapshot.files.has(relativePath)) throw new Error(`快照中没有待移除文件：${relativePath}`);
  const files = new Map(snapshot.files);
  files.delete(relativePath);
  const directories = new Map(snapshot.directories);
  const parent = dirname(relativePath).replaceAll('\\', '/');
  directories.set(parent, (directories.get(parent) ?? []).filter((name) => name !== basename(relativePath)));
  return { files, directories };
}

export function removeRegularFile(path: string, expected: Buffer): void {
  if (!readRegularFile(path).equals(expected)) throw new Error(`待移除文件在检查后发生变化：${path}`);
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
  if (!before.equals(expected)) throw new Error(`目标会话在检查后发生变化，停止标题更新：${path}`);
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

export function acquireFileLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const before = lstatSync(path);
    const raw = readRegularFile(path, 64);
    const value = raw.toString('utf8').trim();
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('同步锁格式异常，请先检查上一次操作。');
    try { process.kill(Number(value), 0); throw new Error('另一个 ClaudeSync 操作正在运行。'); }
    catch (error) {
      if (!isRecord(error) || error.code !== 'ESRCH') throw error;
      const now = lstatSync(path);
      if (now.dev !== before.dev || now.ino !== before.ino || !readRegularFile(path, 64).equals(raw)) throw new Error('同步锁正在变化，请稍后重试。');
      unlinkSync(path);
    }
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
