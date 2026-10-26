import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  assertPlainDirectory,
  inspectTranscript,
  isRecord,
  MAX_INDEX_BYTES,
  readRegularFile,
  takeWorkspaceSnapshot,
} from './storage';
import type { TranscriptCheck, WorkspaceSnapshot } from './storage';
import { historyIds, REMOTE_KEYS, validateSessionRecord } from './record';
import { buildPlan } from './planner';
import type { Account, SessionEntry, SessionRecord, SyncPlan } from './types';
import type { VerifiedOrganizations } from './visibility';
import { userError, userMessage } from '../error-copy';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const ARCHIVE_INDEX = 'archived-sessions.idx';
const MAX_ACCOUNTS = 50;

interface ConfigFile {
  version?: number;
  session_root: string;
  projects_root: string;
  accounts: Account[];
}

interface TranscriptFailure {
  path?: string;
  error: string;
}

export interface Workspace {
  verifiedOrganizations?: VerifiedOrganizations;
  configPath: string;
  configRaw: Buffer;
  baseDirectory: string;
  root: string;
  projectsRoot: string;
  accounts: Account[];
  entries: SessionEntry[];
  snapshot: WorkspaceSnapshot;
  archivedByAccount: Map<string, Set<string>>;
  tombstones: Set<string>;
  transcripts: Map<string, TranscriptCheck | TranscriptFailure>;
  transcriptPaths: Map<string, string[]>;
}

function parseJson<T>(raw: Buffer, path: string): T {
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch (error) {
    throw userError('errorJsonInvalid', { path, error: String(error) });
  }
}

function loadConfig(configPath: string): { config: ConfigFile; raw: Buffer } {
  const raw = readRegularFile(configPath, MAX_INDEX_BYTES);
  const config = parseJson<ConfigFile>(raw, configPath);
  if (!isRecord(config) || !Array.isArray(config.accounts) || config.accounts.length < 1 || config.accounts.length > MAX_ACCOUNTS) {
    throw userError('errorConfigAccounts');
  }
  if (config.version !== undefined && config.version !== 1) throw userError('errorConfigVersion');
  if (typeof config.session_root !== 'string' || !config.session_root.trim()
    || typeof config.projects_root !== 'string' || !config.projects_root.trim()) {
    throw userError('errorConfigPaths');
  }
  const scopes = new Set<string>();
  const labels = new Set<string>();
  for (const [index, account] of config.accounts.entries()) {
    if (!isRecord(account) || typeof account.label !== 'string' || typeof account.scope !== 'string') {
      throw userError('errorConfigAccountInvalid', { index: index + 1 });
    }
    const parts = account.scope.split('/');
    if (parts.length !== 2 || !parts.every((part) => UUID.test(part))) throw userError('errorAccountScopeInvalid', { scope: account.scope });
    const scopeKey = account.scope.toLocaleLowerCase();
    const labelKey = account.label.trim().toLocaleLowerCase();
    if (!labelKey) throw userError('errorAccountNameEmpty');
    if (scopes.has(scopeKey)) throw userError('errorAccountScopeDuplicate', { scope: account.scope });
    if (labels.has(labelKey)) throw userError('errorAccountNameDuplicate', { label: account.label });
    scopes.add(scopeKey);
    labels.add(labelKey);
  }
  return { config, raw };
}

export function collectTranscriptIndex(projectsRoot: string): Map<string, string[]> {
  assertPlainDirectory(projectsRoot);
  const index = new Map<string, string[]>();
  for (const project of readdirSync(projectsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!project.isDirectory()) continue;
    const directory = join(projectsRoot, project.name);
    for (const name of readdirSync(directory).sort()) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (!UUID.test(id)) continue;
      const paths = index.get(id) ?? [];
      paths.push(join(directory, name));
      index.set(id, paths);
    }
  }
  return index;
}

function archivedSessions(snapshot: WorkspaceSnapshot, accounts: Account[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const account of accounts) {
    const archived = new Set<string>();
    const path = `${account.scope}/${ARCHIVE_INDEX}`;
    const raw = snapshot.files.get(path);
    if (raw) {
      const value = parseJson<Record<string, unknown>>(raw, path);
      if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.archived)
        || value.archived.some((item) => typeof item !== 'string')) {
        throw userError('errorArchiveIndexInvalidAt', { path });
      }
      for (const id of value.archived) archived.add(id as string);
    }
    result.set(account.scope, archived);
  }
  return result;
}

function collectTombstones(snapshot: WorkspaceSnapshot, accounts: Account[]): Set<string> {
  const organizations = new Set(accounts.map((account) => account.scope.split('/')[0]));
  const result = new Set<string>();
  for (const path of snapshot.files.keys()) {
    const [organization, , name] = path.split('/');
    if (organization && name?.startsWith('deleted_') && organizations.has(organization)) result.add(name.slice(8));
  }
  return result;
}

export function entryEligibility(
  account: Account,
  data: SessionRecord,
  archived: Map<string, Set<string>>,
  tombstones: Set<string>,
  transcriptIndex: Map<string, string[]>,
  transcripts: Map<string, TranscriptCheck | TranscriptFailure>,
  ignoreArchive = false,
): string | undefined {
  if (data.scheduledTaskId) return userMessage('statusScheduledNotCopied');
  if (!ignoreArchive && (data.isArchived || (archived.get(account.scope)?.has(data.sessionId) || archived.get(account.scope)?.has(data.sessionId.slice(6))))) return userMessage('statusArchivedNotCopied');
  if (REMOTE_KEYS.some((key) => Boolean(data[key]))) return userMessage('statusRemoteNotCopied');
  const ids = historyIds(data);
  if ([...ids, data.sessionId, data.sessionId.slice(6)].some((id) => tombstones.has(id))) return userMessage('statusDeletedHistoryNotCopied');
  if (typeof data.cwd !== 'string') return userMessage('statusWorkingDirectoryMissing');
  try {
    if (!statSync(data.cwd).isDirectory()) return userMessage('statusWorkingDirectoryNotFound');
  } catch {
    return userMessage('statusWorkingDirectoryNotFound');
  }
  for (const id of ids) {
    const matches = transcriptIndex.get(id) ?? [];
    if (matches.length !== 1) return matches.length === 0 ? userMessage('statusTranscriptMissing') : userMessage('statusTranscriptDuplicate');
    if (!transcripts.has(id)) {
      try {
        transcripts.set(id, inspectTranscript(matches[0]!));
      } catch (error) {
        transcripts.set(id, { path: matches[0], error: String(error) });
      }
    }
    const check = transcripts.get(id);
    if (check && 'error' in check) return check.error;
  }
  return undefined;
}

export function loadWorkspace(configPath: string): Workspace {
  const { config, raw: configRaw } = loadConfig(configPath);
  assertPlainDirectory(dirname(resolve(configPath)));
  const root = resolve(config.session_root);
  const projectsRoot = resolve(config.projects_root);
  assertPlainDirectory(root);
  assertPlainDirectory(projectsRoot);
  const snapshot = takeWorkspaceSnapshot(root, config.accounts);
  const archivedByAccount = archivedSessions(snapshot, config.accounts);
  const tombstones = collectTombstones(snapshot, config.accounts);
  const transcriptIndex = collectTranscriptIndex(projectsRoot);
  const transcripts = new Map<string, TranscriptCheck | TranscriptFailure>();
  const entries: SessionEntry[] = [];

  for (const account of config.accounts) {
    for (const [path, raw] of snapshot.files) {
      const parent = dirname(path).replaceAll('\\', '/');
      const name = basename(path);
      if (parent !== account.scope || !name.startsWith('local_') || !name.endsWith('.json')) continue;
      const data = validateSessionRecord(name, parseJson<unknown>(raw, path));
      const syncIssue = entryEligibility(account, data, archivedByAccount, tombstones, transcriptIndex, transcripts, true);
      const archived = Boolean(data.isArchived || (archivedByAccount.get(account.scope)?.has(data.sessionId) || archivedByAccount.get(account.scope)?.has(data.sessionId.slice(6))));
      const reason = syncIssue ?? (archived ? userMessage('statusArchivedNotCopied') : undefined);
      entries.push({ account, path, data, raw, archived, syncIssue, eligible: !reason, ...(reason ? { reason } : {}) });
    }
  }
  return {
    configPath: resolve(configPath),
    configRaw,
    baseDirectory: dirname(resolve(configPath)),
    root,
    projectsRoot,
    accounts: config.accounts,
    entries,
    snapshot,
    archivedByAccount,
    tombstones,
    transcripts,
    transcriptPaths: transcriptIndex,
  };
}

export function buildWorkspacePlan(
  workspace: Workspace,
  titleSelections: Record<string, string> = {},
  excludedAccountScopes: readonly string[] = [],
  selectedSessionIds?: readonly string[],
  sourcePaths?: readonly string[],
): SyncPlan {
  const excluded = new Set(excludedAccountScopes);
  const accounts = workspace.accounts.filter((account) => !excluded.has(account.scope));
  const entries = workspace.entries.filter((entry) => !excluded.has(entry.account.scope));
  return buildPlan(accounts, entries, {
    tombstones: workspace.tombstones,
    verifiedOrganizations: workspace.verifiedOrganizations,
    archivedByAccount: workspace.archivedByAccount,
    titleSelections,
    selectedSessionIds,
    sourcePaths,
  });
}
