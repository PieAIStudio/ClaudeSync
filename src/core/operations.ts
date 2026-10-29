import { captureDependencies } from './data-scope';
import { reconcileProgress } from './sync-progress';
import { accountIdForScope } from './account-identity';
import { isManageable, sessionKey } from './catalog';
import { entryGroup, verifiedTargets } from './visibility';
import { buildWorkspacePlan, entryEligibility } from './workspace';
import type { Workspace } from './workspace';
import { historyIds, isUuid, validateSessionRecord } from './record';
import { updateTitle } from './title-policy';
import { encodeJson } from './transaction';
import type { FileChange, FilePlan } from './transaction';
import type { ChangeView, OperationPreview, OperationRequest } from '../shared/contracts';
import type { SessionEntry, SessionRecord, SyncPlan } from './types';
import { inspectTranscript, takeDeletionSnapshot } from './storage';
import type { TranscriptCheck, WorkspaceSnapshot } from './storage';
import { userError, userMessage } from '../error-copy';

interface OperationPlan extends FilePlan {
  preview: Omit<OperationPreview, 'token'>;
}

interface PlanContext {
  workspace: Workspace;
  request: OperationRequest;
  accountIds: Set<string>;
  selectedIds: Set<string>;
  entries: SessionEntry[];
  selectedEntries: SessionEntry[];
  targetScopes?: Set<string>;
  archives: Map<string, Set<string>>;
  editedEntries: Map<string, SessionRecord>;
  changes: Map<string, FileChange>;
  deletionSnapshot?: WorkspaceSnapshot;
  transcriptRemovals: TranscriptCheck[];
  inputTranscripts: TranscriptCheck[];
  restoredMarkerPaths: string[];
  skipped: OperationPreview['skipped'];
  conflicts: OperationPreview['conflicts'];
  progressUpdates: NonNullable<OperationPreview['progressUpdates']>;
  progressConflicts: NonNullable<OperationPreview['progressConflicts']>;
}

export function changeViews(changes: FileChange[]): ChangeView[] {
  const groups = new Map<string, ChangeView>();
  for (const change of changes) {
    if (!change.sessionId) continue;
    const accountId = accountIdForScope(change.path);
    const key = `${change.action}:${accountId}:${change.sessionId}`;
    const current = groups.get(key) ?? { action: change.action, accountId, sessionId: change.sessionId, title: change.title, copies: 0 };
    current.copies++;
    groups.set(key, current);
  }
  return [...groups.values()];
}

function createPlanContext(workspace: Workspace, request: OperationRequest): PlanContext {
  const accountIds = new Set(request.accountIds);
  const knownAccounts = new Set(workspace.accounts.map((account) => accountIdForScope(account.scope)));
  if (!accountIds.size || [...accountIds].some((id) => !knownAccounts.has(id))) throw userError('errorAccountsSelection');
  const selectedIds = new Set(request.sessionIds);
  if (!selectedIds.size) throw userError('errorSessionSelection');
  const entries = workspace.entries.filter((entry) => accountIds.has(accountIdForScope(entry.account.scope)));
  const targetScopes = request.kind === 'sync' || request.kind === 'keep'
    ? new Set(verifiedTargets(workspace.accounts.filter((account) => accountIds.has(accountIdForScope(account.scope))), workspace.verifiedOrganizations).map((account) => account.scope)) : undefined;
  const selectedEntries = entries.filter((entry) => selectedIds.has(sessionKey(entry)) && (!request.group || entryGroup(workspace, entry) === request.group));
  if (request.group === 'deleted' && request.kind !== 'sync') throw userError('errorDeletedSessionSyncOnly');
  if ([...selectedIds].some((id) => !selectedEntries.some((entry) => sessionKey(entry) === id))) throw userError('errorSessionNotInAccounts');
  if (selectedEntries.some((entry) => !isManageable(entry))) throw userError('errorUnsupportedSession');
  if (request.kind === 'rename' && (selectedIds.size !== 1 || typeof request.title !== 'string'
    || !request.title.trim() || request.title.length > 500 || /[\u0000-\u001f]/u.test(request.title))) throw userError('errorRenameOneSession');
  if ((request.kind === 'sync' || request.kind === 'keep') && accountIds.size < 2) throw userError('errorSyncTwoAccounts');
  return {
    workspace, request, accountIds, selectedIds, entries, selectedEntries, targetScopes,
    archives: new Map([...workspace.archivedByAccount].map(([scope, ids]) => [scope, new Set(ids)])),
    editedEntries: new Map(), changes: new Map(), transcriptRemovals: [], inputTranscripts: [], restoredMarkerPaths: [],
    skipped: [], conflicts: [], progressUpdates: [], progressConflicts: [],
  };
}

function putChange(context: PlanContext, path: string, after: Buffer | undefined, entry: SessionEntry | undefined, action: FileChange['action']): void {
  const before = context.workspace.snapshot.files.get(path);
  if (before && after?.equals(before) || !before && !after) { context.changes.delete(path); return; }
  context.changes.set(path, { path, before, after, sessionId: entry ? sessionKey(entry) : '', title: entry?.data.title || '', action });
}

function editEntry(context: PlanContext, entry: SessionEntry, data: SessionRecord, action: FileChange['action']): void {
  context.editedEntries.set(entry.path, data);
  putChange(context, entry.path, encodeJson(data), entry, action);
}

function archiveEntry(context: PlanContext, entry: SessionEntry, value: boolean): void {
  const ids = context.archives.get(entry.account.scope)!;
  if (value) ids.add(entry.data.sessionId);
  else { ids.delete(entry.data.sessionId); ids.delete(entry.data.sessionId.slice(6)); }
  const data = context.editedEntries.get(entry.path) ?? entry.data;
  if (Boolean(data.isArchived) !== value) editEntry(context, entry, { ...data, isArchived: value }, value ? 'archive' : 'unarchive');
}

function applySimpleOperation(context: PlanContext): void {
  const { request, selectedEntries } = context;
  if (request.kind === 'archive' || request.kind === 'unarchive') {
    for (const entry of selectedEntries) archiveEntry(context, entry, request.kind === 'archive');
  } else if (request.kind === 'rename') {
    for (const entry of selectedEntries) {
      const data = updateTitle(entry.data, { sessionId: entry.data.sessionId, title: request.title!.trim(), titleSource: 'user' });
      editEntry(context, entry, data, 'title');
      const change = context.changes.get(entry.path);
      if (change) change.title = request.title!.trim();
    }
  } else if (request.kind === 'star' || request.kind === 'unstar') {
    for (const entry of selectedEntries) editEntry(context, entry, { ...entry.data, isStarred: request.kind === 'star' }, request.kind);
  }
}

function appendOldCopies(context: PlanContext, snapshot: WorkspaceSnapshot): void {
  const { accountIds, selectedEntries, selectedIds, archives, request, workspace } = context;
  for (const [path, raw] of snapshot.files) {
    const scope = path.split('/').slice(0, 2).join('/');
    const name = path.split('/').at(-1)!;
    if (path.split('/').length !== 3 || !accountIds.has(accountIdForScope(path)) || !archives.has(scope) || selectedEntries.some((entry) => entry.path === path)
      || !name.startsWith('local_') || !name.endsWith('.json')) continue;
    const data = validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
    if (!isUuid(data.cliSessionId) || !selectedIds.has(data.cliSessionId)) continue;
    const copy: SessionEntry = { path, raw, data, account: { scope, label: scope },
      archived: Boolean(data.isArchived || archives.get(scope)?.has(data.sessionId)), eligible: false };
    if (request.group && entryGroup(workspace, copy) !== request.group) continue;
    if (!isManageable(copy)) throw userError('errorUnsafeOldCopy');
    selectedEntries.push(copy);
  }
}

function remainingClaims(snapshot: WorkspaceSnapshot, selectedPaths: Set<string>): { byAccount: Map<string, Set<string>>; all: Set<string> } {
  const byAccount = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const [path, raw] of snapshot.files) {
    const identity = accountIdForScope(path);
    const name = path.split('/').at(-1)!;
    if (path.split('/').length !== 3 || selectedPaths.has(path) || !name.startsWith('local_') || !name.endsWith('.json')) continue;
    const data = validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
    const claims = byAccount.get(identity) ?? new Set<string>();
    for (const id of [...historyIds(data), data.sessionId.slice(6)]) { claims.add(id); all.add(id); }
    byAccount.set(identity, claims);
  }
  return { byAccount, all };
}

function transcriptRemovals(context: PlanContext, snapshot: WorkspaceSnapshot, globalClaims: Set<string>): void {
  const candidates = new Set(context.selectedEntries.flatMap((entry) => [...historyIds(entry.data)]));
  for (const id of candidates) {
    if (globalClaims.has(id) || snapshot.skippedPaths.length) continue;
    const paths = context.workspace.transcriptPaths.get(id) ?? [];
    if (paths.length > 1) throw userError('errorDuplicateTranscript');
    if (paths[0]) context.transcriptRemovals.push(inspectTranscript(paths[0]));
  }
}

function removeSelectedEntries(context: PlanContext, selectedPaths: Set<string>, byAccount: Map<string, Set<string>>): void {
  const { accountIds, archives, request, workspace } = context;
  for (const entry of context.selectedEntries) {
    const owner = accountIdForScope(entry.account.scope);
    const otherClaims = byAccount.get(owner) ?? new Set<string>();
    const currentScope = `${owner}/${workspace.verifiedOrganizations?.[owner] ?? ''}`;
    const currentCounterpart = request.group === 'oldOrganization' && workspace.entries.some((peer) =>
      peer.account.scope === currentScope && !selectedPaths.has(peer.path) && peer.data.cliSessionId === entry.data.cliSessionId);
    if (otherClaims.has(entry.data.sessionId.slice(6)) && !currentCounterpart) {
      throw userError('errorSharedHistoryDelete', { title: entry.data.title || userMessage('statusUntitledCodeSession') });
    }
    putChange(context, entry.path, undefined, entry, 'delete');
    archives.get(entry.account.scope)!.delete(entry.data.sessionId);
    archives.get(entry.account.scope)!.delete(entry.data.sessionId.slice(6));
    for (const id of new Set([entry.data.sessionId.slice(6), ...historyIds(entry.data)])) {
      if (!isUuid(id) || otherClaims.has(id)) continue;
      const marker = `${entry.account.scope}/deleted_${id}`;
      if (!workspace.snapshot.files.has(marker)) putChange(context, marker, Buffer.from(String(Date.now())), undefined, 'delete');
    }
  }
}

function applyDeletion(context: PlanContext): void {
  const snapshot = takeDeletionSnapshot(context.workspace.root);
  context.deletionSnapshot = snapshot;
  appendOldCopies(context, snapshot);
  const selectedPaths = new Set(context.selectedEntries.map((entry) => entry.path));
  const claims = remainingClaims(snapshot, selectedPaths);
  transcriptRemovals(context, snapshot, claims.all);
  removeSelectedEntries(context, selectedPaths, claims.byAccount);
}

function simulatedWorkspace(context: PlanContext, transcripts: Map<string, TranscriptCheck | { path?: string; error: string }>): Workspace {
  const { workspace, request, archives, selectedEntries, selectedIds, accountIds, targetScopes, editedEntries } = context;
  return {
    ...workspace, archivedByAccount: archives, transcripts,
    tombstones: request.kind === 'sync' ? new Set() : workspace.tombstones,
    entries: workspace.entries.map((entry) => {
      const importing = request.kind === 'keep' && selectedEntries.includes(entry) && !targetScopes?.has(entry.account.scope);
      const data = importing ? { ...entry.data, isArchived: false } : editedEntries.get(entry.path) ?? entry.data;
      const archived = !importing && Boolean(data.isArchived || archives.get(entry.account.scope)?.has(data.sessionId) || archives.get(entry.account.scope)?.has(data.sessionId.slice(6)));
      const syncIssue = request.kind === 'sync' && selectedIds.has(sessionKey(entry)) && accountIds.has(accountIdForScope(entry.account.scope))
        ? entryEligibility(entry.account, data, archives, new Set(), workspace.transcriptPaths, transcripts, true) : entry.syncIssue;
      return { ...entry, data, archived, syncIssue, eligible: !syncIssue && !archived };
    }),
  };
}

function applyProgressAndPlan(context: PlanContext, simulated: Workspace): SyncPlan {
  const { workspace, request, accountIds, selectedEntries, selectedIds, targetScopes, archives, editedEntries } = context;
  const excluded = workspace.accounts.filter((account) => !accountIds.has(accountIdForScope(account.scope))).map((account) => account.scope);
  const sourcePaths = selectedEntries.map((entry) => entry.path);
  const progress = request.kind === 'sync' ? reconcileProgress(simulated, sourcePaths, targetScopes!, request.contentSelections)
    : { updates: [], progressUpdates: [], progressConflicts: [], sourcePaths };
  context.progressUpdates = progress.progressUpdates;
  context.progressConflicts = progress.progressConflicts;
  for (const update of progress.updates) editEntry(context, update.target, update.data, 'update');
  simulated.entries = simulated.entries.map((entry) => ({ ...entry, data: editedEntries.get(entry.path) ?? entry.data }));
  const plan = buildWorkspacePlan(simulated, request.titleSelections, excluded, [...selectedIds], progress.sourcePaths);
  for (const addition of plan.additions) putChange(context, addition.targetPath, encodeJson(addition.data), addition.source, 'add');
  return plan;
}

function restoreMarkers(context: PlanContext, simulated: Workspace, plan: SyncPlan): void {
  const { workspace, request, accountIds, selectedIds, targetScopes } = context;
  const restored = [
    ...simulated.entries.filter((entry) => targetScopes!.has(entry.account.scope) && selectedIds.has(sessionKey(entry)) && entry.eligible),
    ...plan.additions.map((addition) => ({ ...addition.source, account: addition.target, path: addition.targetPath, data: addition.data })),
  ];
  for (const [path] of workspace.snapshot.files) {
    const [owner, , name, extra] = path.split('/');
    if (extra || !name?.startsWith('deleted_') || !isUuid(name.slice(8)) || !accountIds.has(owner!)) continue;
    const entry = restored.find((candidate) => accountIdForScope(candidate.account.scope) === owner
      && new Set([...historyIds(candidate.data), candidate.data.sessionId.slice(6)]).has(name.slice(8)));
    if (!entry) continue;
    context.restoredMarkerPaths.push(path);
    putChange(context, path, undefined, entry, 'restore');
  }
}

function appendTitleChanges(context: PlanContext, plan: SyncPlan): void {
  for (const action of plan.titleActions) {
    if (action.data) editEntry(context, action.target, action.data, 'title');
    if (action.status !== 'conflict' && action.status !== 'selected_source' && action.status !== 'selected_target') continue;
    let group = context.conflicts.find((item) => item.id === action.cliSessionId);
    if (!group) { group = { id: action.cliSessionId, options: [] }; context.conflicts.push(group); }
    if (!group.options.some((option) => option.scope === action.target.account.scope)) {
      group.options.push({ scope: action.target.account.scope, accountId: accountIdForScope(action.target.account.scope), title: action.target.data.title || '' });
    }
  }
}

function appendSkipped(context: PlanContext, simulated: Workspace, plan: SyncPlan): void {
  const skippedKeys = new Set<string>();
  for (const entry of context.selectedEntries) {
    if (simulated.entries.find((item) => item.path === entry.path)?.eligible) continue;
    const reason = simulated.entries.find((item) => item.path === entry.path)?.syncIssue ?? userMessage('statusArchivedNotCopied');
    const key = `${sessionKey(entry)}:${reason}`;
    if (!skippedKeys.has(key)) { skippedKeys.add(key); context.skipped.push({ id: sessionKey(entry), title: entry.data.title || '', reason }); }
  }
  for (const item of plan.skipped ?? []) context.skipped.push({ id: '', title: item.title, reason: item.reason });
}

function finishKeep(context: PlanContext, simulated: Workspace, plan: SyncPlan): void {
  const { entries, selectedIds, targetScopes, workspace } = context;
  for (const account of workspace.accounts.filter((item) => targetScopes?.has(item.scope))) for (const id of selectedIds) {
    const present = simulated.entries.some((entry) => entry.account.scope === account.scope && sessionKey(entry) === id && entryGroup(simulated, entry) === 'visible');
    const added = plan.additions.some((addition) => addition.target.scope === account.scope && addition.data.cliSessionId === id);
    if (!present && !added) throw userError('errorKeepCoverage');
  }
  const unselected = entries.filter((item) => targetScopes?.has(item.account.scope) && entryGroup(workspace, item) === 'visible' && !selectedIds.has(sessionKey(item)));
  for (const entry of unselected) archiveEntry(context, entry, true);
}

function applyKeepSelection(context: PlanContext): void {
  const { entries, selectedEntries, selectedIds, targetScopes } = context;
  const unsupported = entries.find((entry) => targetScopes?.has(entry.account.scope) && entryGroup(context.workspace, entry) === 'visible' && !isManageable(entry));
  if (unsupported) throw userError('errorKeepUnsupported', { title: unsupported.data.title || userMessage('statusUntitled') });
  for (const id of selectedIds) if (!selectedEntries.some((entry) => sessionKey(entry) === id && !entry.syncIssue)) {
    throw userError('errorKeepSessionUnavailable', { title: selectedEntries.find((entry) => sessionKey(entry) === id)?.data.title || id });
  }
  for (const entry of entries) if (selectedIds.has(sessionKey(entry)) && targetScopes?.has(entry.account.scope) && isManageable(entry)) archiveEntry(context, entry, false);
}

function applySyncOrKeep(context: PlanContext): void {
  if (context.request.kind === 'keep') applyKeepSelection(context);
  const transcriptChecks = new Map(context.workspace.transcripts);
  const simulated = simulatedWorkspace(context, transcriptChecks);
  const plan = applyProgressAndPlan(context, simulated);
  if (context.request.kind === 'sync') {
    for (const check of transcriptChecks.values()) if (!('error' in check)) context.inputTranscripts.push(check);
    restoreMarkers(context, simulated, plan);
  }
  appendTitleChanges(context, plan);
  appendSkipped(context, simulated, plan);
  if (context.request.kind === 'keep') finishKeep(context, simulated, plan);
}

function appendArchiveChanges(context: PlanContext): void {
  for (const [scope, ids] of context.archives) {
    const before = context.workspace.archivedByAccount.get(scope)!;
    if (ids.size === before.size && [...ids].every((id) => before.has(id))) continue;
    const path = `${scope}/archived-sessions.idx`;
    const old = context.workspace.snapshot.files.get(path);
    const data = old ? JSON.parse(old.toString('utf8')) as Record<string, unknown> : { v: 1 };
    putChange(context, path, encodeJson({ ...data, archived: [...ids].sort() }), undefined, context.request.kind === 'unarchive' ? 'unarchive' : 'archive');
  }
}

export function buildOperationPlan(workspace: Workspace, request: OperationRequest): OperationPlan {
  const context = createPlanContext(workspace, request);
  if (request.kind === 'delete') applyDeletion(context);
  else if (request.kind === 'sync' || request.kind === 'keep') applySyncOrKeep(context);
  else applySimpleOperation(context);
  appendArchiveChanges(context);
  const changes = [...context.changes.values()];
  const selected = [...context.selectedIds].map((id) => ({ id, title: context.selectedEntries.find((entry) => sessionKey(entry) === id)?.data.title || '' }));
  return {
    kind: request.kind, changes, dependencies: request.kind === 'delete' ? captureDependencies(workspace, request) : undefined,
    inputTranscripts: context.inputTranscripts, restoredMarkerPaths: context.restoredMarkerPaths,
    blockingReason: context.progressConflicts.some((conflict) => !conflict.resolved) ? userMessage('errorProgressConflict') : undefined,
    ...(context.deletionSnapshot ? { deletionSnapshot: context.deletionSnapshot, transcriptRemovals: context.transcriptRemovals } : {}),
    preview: { group: request.group, kind: request.kind, accountIds: [...context.accountIds], selected, changes: changeViews(changes), conflicts: context.conflicts,
      progressUpdates: context.progressUpdates, progressConflicts: context.progressConflicts, skipped: context.skipped, fileCount: changes.length },
  };
}
