import { randomUUID } from 'node:crypto';
import { buildCatalog } from '../src/core/catalog';
import { buildOperationPlan, changeViews } from '../src/core/operations';
import { buildRestorePlan, commitFilePlan, listBackups, workspaceRevision } from '../src/core/transaction';
import type { FilePlan } from '../src/core/transaction';
import type { Workspace } from '../src/core/workspace';
import { isRecord } from '../src/core/storage';
import type { OperationKind, OperationRequest, WorkspaceView } from '../src/shared/contracts';
import { SESSION_GROUPS, type SessionGroup } from '../src/shared/contracts';
import { ensureConfiguredWorkspace, includeDesktopAccount, managedWorkspace, rememberIdentities } from './accounts';
import { checkDesktopIdentity } from './desktop-identity';
import { assertClaudeStopped, processBlockers } from './processes';
import { executeOldCleanup, planOldCleanup } from '../src/core/old-organization';
import type { OldCleanupPlan } from '../src/core/old-organization';

const pending = new Map<string, { workspace: Workspace; plan: FilePlan; at: number }>();
const pendingOld = new Map<string, { workspace: Workspace; plan: OldCleanupPlan; at: number }>();

function freshWorkspace(revision: unknown): Workspace {
  const workspace = managedWorkspace(ensureConfiguredWorkspace());
  if (typeof revision !== 'string' || revision !== workspaceRevision(workspace)) throw new Error('Code 会话列表已经变化，请重新检查后再选择。');
  return workspace;
}

function assertOrganizationCurrent(workspace: Workspace): void {
  if (workspaceRevision(managedWorkspace(workspace)) !== workspaceRevision(workspace)) throw new Error('账号的当前组织已改变，请重新检查和预览。');
}

function normalizeRequest(value: unknown): OperationRequest {
  const kinds: readonly OperationKind[] = ['sync', 'keep', 'archive', 'unarchive', 'delete', 'rename', 'star', 'unstar'];
  if (!isRecord(value) || !kinds.includes(value.kind as OperationKind) || !Array.isArray(value.sessionIds)
    || !Array.isArray(value.accountIds) || value.sessionIds.some((id) => typeof id !== 'string')
    || value.accountIds.some((id) => typeof id !== 'string') || value.sessionIds.length > 5000) throw new Error('操作参数无效。');
  if (value.group !== undefined && !SESSION_GROUPS.includes(value.group as SessionGroup)) throw new Error('Code 会话分组参数无效。');
  const choices: Record<string, string> = {};
  if (isRecord(value.titleSelections)) {
    for (const [id, scope] of Object.entries(value.titleSelections)) if (typeof scope === 'string') choices[id] = scope;
  }
  return { group: (value.group ?? 'visible') as SessionGroup, kind: value.kind as OperationRequest['kind'], sessionIds: [...new Set(value.sessionIds as string[])],
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
  if (request.kind === 'delete') throw new Error('删除请使用“删除选中的Code 会话”确认窗口。');
  const plan = buildOperationPlan(workspace, request);
  return { ...plan.preview, token: savePreview(workspace, plan) };
}

export async function deleteSelected(value: unknown, revision: unknown) {
  if (!isRecord(value)) throw new Error('删除参数无效。');
  const request = normalizeRequest({ group: value.group, sessionIds: value.sessionIds, accountIds: value.accountIds, kind: 'delete' });
  const workspace = freshWorkspace(revision);
  assertClaudeStopped();
  const plan = buildOperationPlan(workspace, request);
  const result = commitFilePlan(workspace, plan, () => { assertClaudeStopped(); assertOrganizationCurrent(workspace); });
  return { result, workspace: await checkWorkspace() };
}

export async function applyOperation(token: unknown) {
  if (typeof token !== 'string') throw new Error('请先预览操作。');
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry || Date.now() - entry.at > 15 * 60 * 1000) throw new Error('操作预览已过期，请重新预览。');
  const result = commitFilePlan(entry.workspace, entry.plan, () => { assertClaudeStopped(); assertOrganizationCurrent(entry.workspace); });
  return { result, workspace: await checkWorkspace() };
}

export function previewOldCopies(value: unknown, revision: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50 || value.some((id) => typeof id !== 'string')) throw new Error('请选择要清理的账号。');
  const workspace = freshWorkspace(revision);
  const plan = planOldCleanup(workspace, value as string[]);
  if (!plan.items.length) return { token: '', items: [], accountIds: plan.accountIds, trashCount: 0, archivedToImport: 0 };
  for (const [key, item] of pendingOld) if (Date.now() - item.at > 15 * 60 * 1000) pendingOld.delete(key);
  if (pendingOld.size >= 10) pendingOld.delete(pendingOld.keys().next().value!);
  const token = randomUUID();
  pendingOld.set(token, { workspace, plan, at: Date.now() });
  return { token, items: plan.items, accountIds: plan.accountIds, trashCount: plan.removals.length, archivedToImport: plan.imports.length };
}

export async function cleanupOldCopies(token: unknown, trash: (path: string) => Promise<void>) {
  if (typeof token !== 'string' || !token) throw new Error('请先查看旧副本清单。');
  const saved = pendingOld.get(token);
  pendingOld.delete(token); // Single-use even when blocked; never retry Trash automatically.
  if (!saved || Date.now() - saved.at > 15 * 60 * 1000) throw new Error('清理清单已过期，请重新查看。');
  freshWorkspace(workspaceRevision(saved.workspace));
  assertClaudeStopped();
  const result = await executeOldCleanup(saved.workspace, saved.plan, trash,
    () => { assertClaudeStopped(); assertOrganizationCurrent(saved.workspace); });
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
