import type { SessionRecord } from './types';
import { createHash } from 'node:crypto';
import { userError } from '../error-copy';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const LOCAL_INDEX = /^local_([0-9a-f-]{36})\.json$/u;
const PORTABLE_KEYS = new Set([
  'sessionId', 'cliSessionId', 'priorCliSessionIds', 'cwd', 'originCwd', 'worktreePath',
  'branchName', 'gitBranch', 'createdAt', 'lastActivityAt', 'model', 'title', 'titleSource',
  'titleTurn', 'isArchived', 'isStarred', 'completedTurns', 'effort', 'effortInherited',
  'lastAssistantUuid', 'rewindEdges', 'transcriptModelStates',
]);
export const REMOTE_KEYS = [
  'remoteTarget', 'sshConnectionId', 'sshConfig', 'wslConfig', 'cloudSessionId',
  'remoteSessionId', 'violinBow',
] as const;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function deterministicBranchIndexId(targetScope: string, cliSessionId: string): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const digest = createHash('sha1')
    .update(namespace)
    .update(`claude-session-sync:${targetScope}:${cliSessionId}`)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function validateSessionRecord(filename: string, value: unknown): SessionRecord {
  const match = LOCAL_INDEX.exec(filename);
  if (!match || !isUuid(match[1]) || !isRecord(value) || value.sessionId !== filename.slice(0, -5)) {
    throw userError('errorInvalidLocalSession', { filename });
  }
  const record = value as SessionRecord;
  if (REMOTE_KEYS.some((key) => Boolean(record[key]))) return record;
  if (!isUuid(record.cliSessionId) || typeof record.cwd !== 'string' || !isAbsolutePath(record.cwd)) {
    throw userError('errorInvalidLocalSession', { filename });
  }
  for (const key of ['isArchived', 'isStarred'] as const) {
    if (key in record && typeof record[key] !== 'boolean') throw userError('errorBooleanFieldChanged', { filename, key });
  }
  for (const key of ['title', 'model'] as const) {
    if (key in record && typeof record[key] !== 'string') throw userError('errorTextFieldChanged', { filename, key });
  }
  if (record.scheduledTaskId != null && typeof record.scheduledTaskId !== 'string') throw userError('errorScheduledTaskFieldChanged', { filename });
  const prior = 'priorCliSessionIds' in record ? record.priorCliSessionIds : [];
  if (!Array.isArray(prior) || prior.some((id) => !isUuid(id))) throw userError('errorHistoryIdChanged', { filename });
  const edges = 'rewindEdges' in record ? record.rewindEdges : [];
  if (!Array.isArray(edges)) throw userError('errorBranchRelationInvalid', { filename });
  for (const edge of edges) {
    if (!isRecord(edge) || !['id', 'parent', 'child'].every((key) => isUuid(edge[key]))) {
      throw userError('errorBranchRelationFieldChanged', { filename });
    }
    if ('cwd' in edge && (typeof edge.cwd !== 'string' || !isAbsolutePath(edge.cwd))) {
      throw userError('errorBranchCwdChanged', { filename });
    }
  }
  const states = 'transcriptModelStates' in record ? record.transcriptModelStates : {};
  if (!isRecord(states) || Object.entries(states).some(([id, item]) => !isUuid(id) || !isRecord(item))) {
    throw userError('errorModelStateChanged', { filename });
  }
  return record;
}

export function historyIds(data: SessionRecord): Set<string> {
  const ids = new Set<string>();
  if (isUuid(data.cliSessionId)) ids.add(data.cliSessionId);
  for (const id of Array.isArray(data.priorCliSessionIds) ? data.priorCliSessionIds : []) {
    if (isUuid(id)) ids.add(id);
  }
  for (const edge of Array.isArray(data.rewindEdges) ? data.rewindEdges : []) {
    if (isRecord(edge)) {
      if (isUuid(edge.parent)) ids.add(edge.parent);
      if (isUuid(edge.child)) ids.add(edge.child);
    }
  }
  if (isRecord(data.transcriptModelStates)) {
    for (const id of Object.keys(data.transcriptModelStates)) if (isUuid(id)) ids.add(id);
  }
  return ids;
}

export function portableRecord(data: SessionRecord, sessionId?: string, title?: string): SessionRecord {
  const copied: SessionRecord = {} as SessionRecord;
  for (const [key, value] of Object.entries(data)) if (PORTABLE_KEYS.has(key)) copied[key] = value;
  if (sessionId) {
    copied.sessionId = sessionId;
    copied.isStarred = false;
  }
  if (title) copied.title = title;
  Object.assign(copied, {
    permissionMode: 'default',
    enabledMcpTools: {},
    remoteMcpServersConfig: [],
    alwaysAllowedReasons: [],
    sessionPermissionUpdates: [],
    spawnSeed: {},
  });
  return copied;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\');
}
