import { accountIdForScope } from './account-identity';
import { historyIds, isUuid } from './record';
import { assertTranscriptCurrent, isRecord, readRegularFile } from './storage';
import type { Workspace } from './workspace';
import type { SessionEntry, SessionRecord } from './types';
import type { ProgressConflictView, ProgressUpdateView } from '../shared/contracts';
import { userError } from '../error-copy';

// Resume state is portable; destination permissions, title, archive/star state,
// entry ID and unknown account-local fields are not replaced by a peer's copy.
const RESUME_KEYS = ['cliSessionId', 'priorCliSessionIds', 'cwd', 'originCwd', 'worktreePath',
  'branchName', 'gitBranch', 'lastActivityAt', 'model', 'completedTurns', 'effort', 'effortInherited',
  'lastAssistantUuid', 'rewindEdges', 'transcriptModelStates'] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function progressKey(data: SessionRecord): string {
  return canonical(Object.fromEntries(RESUME_KEYS.filter((key) => key !== 'lastActivityAt').map((key) => [key, data[key]])));
}
function turns(data: SessionRecord): number | undefined {
  return Number.isSafeInteger(data.completedTurns) && data.completedTurns! >= 0 ? data.completedTurns : undefined;
}
function activity(data: SessionRecord): number | undefined {
  const value = data.lastActivityAt;
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && !Number.isNaN(new Date(time).getTime()) ? time : undefined;
}

// These files are shared across local accounts: synchronize resume pointers, not
// JSONL bytes. Only proven ancestry authorizes automatic advancement. Missing,
// oversized, malformed or ambiguous evidence requires an explicit user choice.
function parentsFor(workspace: Workspace, peers: SessionEntry[]): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  let budget = 64 * 1024 * 1024;
  try {
    for (const id of new Set(peers.flatMap((entry) => [...historyIds(entry.data)]))) {
      const check = workspace.transcripts.get(id);
      if (!check || 'error' in check) return new Map();
      assertTranscriptCurrent(check);
      const raw = readRegularFile(check.path, budget);
      budget -= raw.length;
      for (const line of raw.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const node: unknown = JSON.parse(line);
        if (!isRecord(node) || !isUuid(node.uuid)) continue;
        if (node.parentUuid !== null && !isUuid(node.parentUuid)) return new Map();
        if (parents.has(node.uuid) && parents.get(node.uuid) !== node.parentUuid) return new Map();
        parents.set(node.uuid, node.parentUuid as string | null);
      }
      assertTranscriptCurrent(check);
    }
  } catch { return new Map(); }
  return parents;
}
function extendsCopy(newer: SessionEntry, older: SessionEntry, parents: Map<string, string | null>): boolean {
  const head = newer.data.lastAssistantUuid;
  const ancestor = older.data.lastAssistantUuid;
  if (!isUuid(head) || !isUuid(ancestor) || head === ancestor || !parents.has(ancestor)) return false;
  const beforeTurns = turns(older.data), afterTurns = turns(newer.data);
  if (beforeTurns !== undefined && afterTurns !== undefined && afterTurns < beforeTurns) return false;
  // A head may be descended while a rewind/history branch was dropped. That is
  // not a safe superset; retain both copies until the user selects a version.
  const newerHistory = historyIds(newer.data);
  if ([...historyIds(older.data)].some((id) => !newerHistory.has(id))) return false;
  const olderEdges = Array.isArray(older.data.rewindEdges) ? older.data.rewindEdges : [];
  const newerEdges = new Set((Array.isArray(newer.data.rewindEdges) ? newer.data.rewindEdges : []).map(canonical));
  if (olderEdges.some((edge) => !newerEdges.has(canonical(edge)))) return false;
  const seen = new Set<string>();
  let cursor: string | null | undefined = head;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestor) return true;
    seen.add(cursor); cursor = parents.get(cursor);
  }
  return false;
}

export function reconcileProgress(workspace: Workspace, sourcePaths: string[], targetScopes: Set<string>, choices: Record<string, string> = {}) {
  const sources = new Set(sourcePaths);
  const ids = new Set(workspace.entries.filter((entry) => sources.has(entry.path)).map((entry) => entry.data.cliSessionId));
  const updates: Array<{ target: SessionEntry; data: SessionRecord }> = [];
  const progressUpdates: ProgressUpdateView[] = [];
  const progressConflicts: ProgressConflictView[] = [];
  const chosenPaths: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const peers = workspace.entries.filter((entry) => entry.eligible && entry.data.cliSessionId === id
      && (sources.has(entry.path) || targetScopes.has(entry.account.scope))).sort((a, b) => a.path.localeCompare(b.path));
    if (!peers.length) continue;
    const keys = new Map(peers.map((entry) => [entry.path, progressKey(entry.data)]));
    const different = new Set(keys.values()).size > 1;
    const parents = different ? parentsFor(workspace, peers) : new Map<string, string | null>();
    const selected = choices[id] ? peers.find((entry) => entry.path === choices[id]) : undefined;
    if (choices[id] && !selected) throw userError('errorSessionVersionChanged');
    const automatic = peers.filter((candidate) => peers.every((peer) => keys.get(candidate.path) === keys.get(peer.path) || extendsCopy(candidate, peer, parents)))
      .sort((a, b) => (activity(b.data) ?? 0) - (activity(a.data) ?? 0))[0];
    const chosen = selected ?? automatic;
    if (different && !automatic) progressConflicts.push({ id, title: peers[0]!.data.title || '', resolved: Boolean(selected),
      options: peers.map((entry) => ({ path: entry.path, accountId: accountIdForScope(entry.account.scope), title: entry.data.title || '',
        turns: turns(entry.data), updatedAt: activity(entry.data) === undefined ? undefined : new Date(activity(entry.data)!).toISOString() })) });
    if (!chosen) continue;
    chosenPaths.push(chosen.path);
    for (const target of peers) {
      if (!targetScopes.has(target.account.scope) || keys.get(target.path) === keys.get(chosen.path)) continue;
      const data = { ...target.data };
      for (const key of RESUME_KEYS) { delete data[key]; if (key in chosen.data) data[key] = chosen.data[key] as never; }
      updates.push({ target, data });
      const from = turns(target.data), to = turns(chosen.data);
      progressUpdates.push({ id, title: chosen.data.title || '', sourceAccountId: accountIdForScope(chosen.account.scope),
        targetAccountId: accountIdForScope(target.account.scope), sourceTurns: to, targetTurns: from,
        deltaTurns: from !== undefined && to !== undefined ? to - from : undefined, selected: Boolean(selected),
        updatedAt: activity(chosen.data) === undefined ? undefined : new Date(activity(chosen.data)!).toISOString() });
    }
  }
  return { updates, progressUpdates, progressConflicts, sourcePaths: chosenPaths };
}
