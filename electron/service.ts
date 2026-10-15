import { randomUUID } from 'node:crypto';
import { buildCatalog } from '../src/core/catalog';
import { buildOperationPlan, changeViews } from '../src/core/operations';
import { buildRestorePlan, commitFilePlan, listBackups, workspaceRevision } from '../src/core/transaction';
import type { FilePlan } from '../src/core/transaction';
import type { Workspace } from '../src/core/workspace';
import { isRecord } from '../src/core/storage';
import type { OperationKind, OperationRequest, WorkspaceView } from '../src/shared/contracts';
import { ensureConfiguredWorkspace, includeDesktopAccount, managedWorkspace, rememberIdentities } from './accounts';
import { checkDesktopIdentity } from './desktop-identity';
import { assertClaudeStopped, processBlockers } from './processes';

const pending = new Map<string, { workspace: Workspace; plan: FilePlan; at: number }>();

function freshWorkspace(revision: unknown): Workspace {
  const workspace = managedWorkspace(ensureConfiguredWorkspace());
  if (typeof revision !== 'string' || revision !== workspaceRevision(workspace)) throw new Error('聊天列表已经变化，请重新检查后再选择。');
  return workspace;
}

function normalizeRequest(value: unknown): OperationRequest {
  const kinds: readonly OperationKind[] = ['sync', 'keep', 'archive', 'unarchive', 'delete', 'rename', 'star', 'unstar'];
  if (!isRecord(value) || !kinds.includes(value.kind as OperationKind) || !Array.isArray(value.sessionIds)
    || !Array.isArray(value.accountIds) || value.sessionIds.some((id) => typeof id !== 'string')
    || value.accountIds.some((id) => typeof id !== 'string') || value.sessionIds.length > 5000) throw new Error('操作参数无效。');
  const choices: Record<string, string> = {};
  if (isRecord(value.titleSelections)) {
    for (const [id, scope] of Object.entries(value.titleSelections)) if (typeof scope === 'string') choices[id] = scope;
  }
  return { kind: value.kind as OperationRequest['kind'], sessionIds: [...new Set(value.sessionIds as string[])],
    accountIds: [...new Set(value.accountIds as string[])], title: typeof value.title === 'string' ? value.title : undefined, titleSelections: choices };
}

function savePreview(workspace: Workspace, plan: FilePlan): string {
  for (const [id, item] of pending) if (Date.now() - item.at > 15 * 60 * 1000) pending.delete(id);
  if (pending.size >= 10) pending.delete(pending.keys().next().value!);
  const token = randomUUID();
  pending.set(token, { workspace, plan, at: Date.now() });
  return token;
}

export async function checkWorkspace(): Promise<WorkspaceView> {
  const desktop = await checkDesktopIdentity();
  const discovered = includeDesktopAccount(ensureConfiguredWorkspace(), desktop.identity);
  const emails = rememberIdentities(discovered.accounts, desktop.identity);
  const workspace = managedWorkspace(discovered);
  return { checkedAt: new Date().toISOString(), revision: workspaceRevision(workspace), blockers: processBlockers(),
    identityState: desktop.state,
    ...buildCatalog(workspace, emails, desktop.identity?.accountId) };
}

export function previewOperation(value: unknown, revision: unknown) {
  const workspace = freshWorkspace(revision);
  const request = normalizeRequest(value);
  if (request.kind === 'delete') throw new Error('删除请使用“删除选中的聊天”确认窗口。');
  const plan = buildOperationPlan(workspace, request);
  return { ...plan.preview, token: savePreview(workspace, plan) };
}

export async function deleteSelected(value: unknown, revision: unknown) {
  if (!isRecord(value)) throw new Error('删除参数无效。');
  const request = normalizeRequest({ sessionIds: value.sessionIds, accountIds: value.accountIds, kind: 'delete' });
  const workspace = freshWorkspace(revision);
  assertClaudeStopped();
  const plan = buildOperationPlan(workspace, request);
  const result = commitFilePlan(workspace, plan, assertClaudeStopped);
  return { result, workspace: await checkWorkspace() };
}

export async function applyOperation(token: unknown) {
  if (typeof token !== 'string') throw new Error('请先预览操作。');
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry || Date.now() - entry.at > 15 * 60 * 1000) throw new Error('操作预览已过期，请重新预览。');
  const result = commitFilePlan(entry.workspace, entry.plan, assertClaudeStopped);
  return { result, workspace: await checkWorkspace() };
}

export function availableBackups() { return listBackups(ensureConfiguredWorkspace().baseDirectory); }

export function previewRestore(id: unknown, revision: unknown) {
  if (typeof id !== 'string') throw new Error('请选择备份。');
  const workspace = freshWorkspace(revision);
  const plan = buildRestorePlan(workspace, id);
  return { kind: 'restore' as const, token: savePreview(workspace, plan), changes: changeViews(plan.changes),
    selected: [], accountIds: [...new Set(plan.changes.map((change) => change.path.split('/')[0]!))],
    conflicts: [], skipped: [], fileCount: plan.changes.length };
}
