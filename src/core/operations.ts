import { accountIdForScope } from './account-identity';
import { isManageable, sessionKey } from './catalog';
import { entryGroup, verifiedTargets } from './visibility';
import { buildWorkspacePlan } from './workspace';
import type { Workspace } from './workspace';
import { historyIds, isUuid, validateSessionRecord } from './record';
import { updateTitle } from './title-policy';
import { encodeJson } from './transaction';
import type { FileChange, FilePlan } from './transaction';
import type { ChangeView, OperationPreview, OperationRequest } from '../shared/contracts';
import type { SessionEntry, SessionRecord } from './types';
import { inspectTranscript, takeDeletionSnapshot } from './storage';
import type { TranscriptCheck, WorkspaceSnapshot } from './storage';

export interface OperationPlan extends FilePlan {
  preview: Omit<OperationPreview, 'token'>;
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

export function buildOperationPlan(workspace: Workspace, request: OperationRequest): OperationPlan {
  const accountIds = new Set(request.accountIds);
  const knownAccounts = new Set(workspace.accounts.map((account) => accountIdForScope(account.scope)));
  if (!accountIds.size || [...accountIds].some((id) => !knownAccounts.has(id))) throw new Error('请选择要处理的账号。');
  const selectedIds = new Set(request.sessionIds);
  if (!selectedIds.size) throw new Error('请先勾选Code 会话。');
  const entries = workspace.entries.filter((entry) => accountIds.has(accountIdForScope(entry.account.scope)));
  const targetScopes = request.kind === 'sync' || request.kind === 'keep'
    ? new Set(verifiedTargets(workspace.accounts.filter((account) => accountIds.has(accountIdForScope(account.scope))), workspace.verifiedOrganizations).map((account) => account.scope)) : undefined;
  const selectedEntries = entries.filter((entry) => selectedIds.has(sessionKey(entry)) && (!request.group || entryGroup(workspace, entry) === request.group));
  if (request.group === 'deleted') throw new Error('有删除标记的记录不能恢复或修改。');
  if ([...selectedIds].some((id) => !selectedEntries.some((entry) => sessionKey(entry) === id))) throw new Error('选中Code 会话不在所选账号内，请重新选择。');
  if (selectedEntries.some((entry) => !isManageable(entry))) throw new Error('远程、云端或定时任务请在 Claude 内处理。');
  if (request.kind === 'rename' && (selectedIds.size !== 1 || typeof request.title !== 'string'
    || !request.title.trim() || request.title.length > 500 || /[\u0000-\u001f]/u.test(request.title))) {
    throw new Error('一次只能给一条Code 会话改标题；标题需为 1 到 500 个字符。');
  }
  if ((request.kind === 'sync' || request.kind === 'keep') && accountIds.size < 2) throw new Error('同步至少需要选择两个账号。');

  const changes = new Map<string, FileChange>();
  const archives = new Map([...workspace.archivedByAccount].map(([scope, ids]) => [scope, new Set(ids)]));
  const editedEntries = new Map<string, SessionRecord>();
  let deletionSnapshot: WorkspaceSnapshot | undefined;
  const transcriptRemovals: TranscriptCheck[] = [];
  function put(path: string, after: Buffer | undefined, entry: SessionEntry | undefined, action: FileChange['action']): void {
    const before = workspace.snapshot.files.get(path);
    if (before && after?.equals(before) || !before && !after) { changes.delete(path); return; }
    changes.set(path, { path, before, after, sessionId: entry ? sessionKey(entry) : '', title: entry?.data.title || '', action });
  }
  function edit(entry: SessionEntry, data: SessionRecord, action: FileChange['action']): void {
    editedEntries.set(entry.path, data);
    put(entry.path, encodeJson(data), entry, action);
  }
  function archive(entry: SessionEntry, value: boolean): void {
    const ids = archives.get(entry.account.scope)!;
    if (value) ids.add(entry.data.sessionId);
    else { ids.delete(entry.data.sessionId); ids.delete(entry.data.sessionId.slice(6)); }
    const data = editedEntries.get(entry.path) ?? entry.data;
    if (Boolean(data.isArchived) !== value) edit(entry, { ...data, isArchived: value }, value ? 'archive' : 'unarchive');
  }

  if (request.kind === 'archive' || request.kind === 'unarchive') {
    for (const entry of selectedEntries) archive(entry, request.kind === 'archive');
  } else if (request.kind === 'rename') {
    for (const entry of selectedEntries) {
      const data = updateTitle(entry.data, { sessionId: entry.data.sessionId, title: request.title!.trim(), titleSource: 'user' });
      edit(entry, data, 'title');
      const change = changes.get(entry.path);
      if (change) change.title = request.title!.trim();
    }
  } else if (request.kind === 'star' || request.kind === 'unstar') {
    for (const entry of selectedEntries) edit(entry, { ...entry.data, isStarred: request.kind === 'star' }, request.kind);
  } else if (request.kind === 'delete') {
    deletionSnapshot = takeDeletionSnapshot(workspace.root);
    // A displayed session can also have an old copy in a configured organization
    // of the same login. Delete those copies too, without crossing account IDs.
    for (const [path, raw] of deletionSnapshot.files) {
      const scope = path.split('/').slice(0, 2).join('/');
      const name = path.split('/').at(-1)!;
      if (!accountIds.has(accountIdForScope(path)) || !archives.has(scope) || selectedEntries.some((entry) => entry.path === path)
        || !name.startsWith('local_') || !name.endsWith('.json')) continue;
      const data = validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
      if (!isUuid(data.cliSessionId) || !selectedIds.has(data.cliSessionId)) continue;
      const copy: SessionEntry = { path, raw, data, account: { scope, label: scope },
        archived: Boolean(data.isArchived || archives.get(scope)?.has(data.sessionId)), eligible: false };
      if (request.group && entryGroup(workspace, copy) !== request.group) continue;
      if (!isManageable(copy)) throw new Error('所选Code 会话有无法安全处理的旧副本，请先在 Claude 中处理。');
      selectedEntries.push(copy);
    }
    const selectedPaths = new Set(selectedEntries.map((entry) => entry.path));
    const remainingClaims = new Map<string, Set<string>>();
    const globalClaims = new Set<string>();
    // Sibling organization folders can exist outside the configured list. Their
    // claims still protect shared history from account-wide native tombstones.
    for (const [path, raw] of deletionSnapshot.files) {
      const identity = accountIdForScope(path);
      const name = path.split('/').at(-1)!;
      if (selectedPaths.has(path) || !name.startsWith('local_') || !name.endsWith('.json')) continue;
      const data = validateSessionRecord(name, JSON.parse(raw.toString('utf8')));
      const claims = remainingClaims.get(identity) ?? new Set<string>();
      for (const id of [...historyIds(data), data.sessionId.slice(6)]) { claims.add(id); globalClaims.add(id); }
      remainingClaims.set(identity, claims);
    }
    const candidates = new Set(selectedEntries.flatMap((entry) => [...historyIds(entry.data)]));
    for (const id of candidates) {
      if (globalClaims.has(id)) continue;
      const paths = workspace.transcriptPaths.get(id) ?? [];
      if (paths.length > 1) throw new Error('不同项目中存在相同Code 会话正文，暂不能确定删除范围。');
      if (paths[0]) transcriptRemovals.push(inspectTranscript(paths[0]));
    }
    for (const entry of selectedEntries) {
      const otherClaims = remainingClaims.get(accountIdForScope(entry.account.scope)) ?? new Set<string>();
      if (otherClaims.has(entry.data.sessionId.slice(6))) {
        throw new Error(`其他Code 会话或未参与整理的目录仍在使用这条Code 会话的历史，暂不能安全删除，请改用归档：${entry.data.title || '未命名Code 会话'}`);
      }
      put(entry.path, undefined, entry, 'delete');
      archives.get(entry.account.scope)!.delete(entry.data.sessionId);
      archives.get(entry.account.scope)!.delete(entry.data.sessionId.slice(6));
      for (const id of new Set([entry.data.sessionId.slice(6), ...historyIds(entry.data)])) {
        if (!isUuid(id) || otherClaims.has(id)) continue;
        const marker = `${entry.account.scope}/deleted_${id}`;
        if (!workspace.snapshot.files.has(marker)) put(marker, Buffer.from(String(Date.now())), undefined, 'delete');
      }
    }
  }

  const skipped: OperationPreview['skipped'] = [];
  const conflicts: OperationPreview['conflicts'] = [];
  if (request.kind === 'keep') {
    const unsupported = entries.find((entry) => targetScopes?.has(entry.account.scope) && entryGroup(workspace, entry) === 'visible' && !isManageable(entry));
    if (unsupported) throw new Error(`“只保留所选”不能自动整理远程或定时任务：${unsupported.data.title || '未命名'}。请先在 Claude 中处理。`);
    for (const id of selectedIds) {
      if (!selectedEntries.some((entry) => sessionKey(entry) === id && !entry.syncIssue)) {
        throw new Error(`这条Code 会话暂时不能补到所有账号，尚未归档任何Code 会话：${selectedEntries.find((entry) => sessionKey(entry) === id)?.data.title || id}`);
      }
    }
    for (const entry of entries) {
      if (selectedIds.has(sessionKey(entry)) && targetScopes?.has(entry.account.scope) && isManageable(entry)) archive(entry, false);
    }
  }
  if (request.kind === 'sync' || request.kind === 'keep') {
    const simulated: Workspace = {
      ...workspace, archivedByAccount: archives,
      entries: workspace.entries.map((entry) => {
        const importing = request.kind === 'keep' && selectedEntries.includes(entry) && !targetScopes?.has(entry.account.scope);
        const data = importing ? { ...entry.data, isArchived: false } : editedEntries.get(entry.path) ?? entry.data;
        const archived = !importing && Boolean(data.isArchived || archives.get(entry.account.scope)?.has(data.sessionId) || archives.get(entry.account.scope)?.has(data.sessionId.slice(6)));
        return { ...entry, data, archived, eligible: !entry.syncIssue && !archived };
      }),
    };
    const excluded = workspace.accounts.filter((account) => !accountIds.has(accountIdForScope(account.scope))).map((account) => account.scope);
    const plan = buildWorkspacePlan(simulated, request.titleSelections, excluded, [...selectedIds], selectedEntries.map((entry) => entry.path));
    for (const addition of plan.additions) put(addition.targetPath, encodeJson(addition.data), addition.source, 'add');
    for (const action of plan.titleActions) {
      if (action.data) edit(action.target, action.data, 'title');
      if (action.status !== 'conflict' && action.status !== 'selected_source' && action.status !== 'selected_target') continue;
      let group = conflicts.find((item) => item.id === action.cliSessionId);
      if (!group) { group = { id: action.cliSessionId, options: [] }; conflicts.push(group); }
      if (!group.options.some((option) => option.scope === action.target.account.scope)) {
        group.options.push({ scope: action.target.account.scope, accountId: accountIdForScope(action.target.account.scope), title: action.target.data.title || '' });
      }
    }
    const skippedKeys = new Set<string>();
    for (const entry of selectedEntries) {
      if (simulated.entries.find((item) => item.path === entry.path)?.eligible) continue;
      const reason = entry.syncIssue ?? '来源会话已归档';
      const key = `${sessionKey(entry)}:${reason}`;
      if (!skippedKeys.has(key)) { skippedKeys.add(key); skipped.push({ id: sessionKey(entry), title: entry.data.title || '', reason }); }
    }
    for (const item of plan.skipped ?? []) skipped.push({ id: '', title: item.title, reason: item.reason });
    if (request.kind === 'keep') {
      for (const account of workspace.accounts.filter((account) => targetScopes?.has(account.scope))) {
        for (const id of selectedIds) {
          const present = simulated.entries.some((entry) => entry.account.scope === account.scope && sessionKey(entry) === id && entryGroup(simulated, entry) === 'visible');
          const added = plan.additions.some((addition) => addition.target.scope === account.scope && addition.data.cliSessionId === id);
          if (!present && !added) throw new Error('有账号无法得到全部选中Code 会话，尚未执行。请先解决删除标记或缺失正文问题。');
        }
      }
      for (const entry of entries.filter((entry) => targetScopes?.has(entry.account.scope) && entryGroup(workspace, entry) === 'visible' && !selectedIds.has(sessionKey(entry)))) archive(entry, true);
    }
  }

  for (const [scope, ids] of archives) {
    const before = workspace.archivedByAccount.get(scope)!;
    if (ids.size === before.size && [...ids].every((id) => before.has(id))) continue;
    const path = `${scope}/archived-sessions.idx`;
    const old = workspace.snapshot.files.get(path);
    const data = old ? JSON.parse(old.toString('utf8')) as Record<string, unknown> : { v: 1 };
    put(path, encodeJson({ ...data, archived: [...ids].sort() }), undefined, request.kind === 'unarchive' ? 'unarchive' : 'archive');
  }
  const result = [...changes.values()];
  const selected = [...selectedIds].map((id) => ({ id, title: selectedEntries.find((entry) => sessionKey(entry) === id)?.data.title || '' }));
  return {
    kind: request.kind, changes: result,
    ...(deletionSnapshot ? { deletionSnapshot, transcriptRemovals } : {}),
    preview: { group: request.group, kind: request.kind, accountIds: [...accountIds], selected, changes: changeViews(result), conflicts, skipped, fileCount: result.length },
  };
}
