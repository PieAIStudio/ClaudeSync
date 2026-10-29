import { captureDependencies, dependencyError, selectionRevision, type DataSelection } from '../src/core/data-scope';
import { randomUUID } from 'node:crypto';
import { buildCatalog } from '../src/core/catalog';
import { buildOperationPlan, changeViews } from '../src/core/operations';
import { buildRestorePlan, commitFilePlan, commitFilePlanWithTrash, listBackups, workspaceRevision } from '../src/core/transaction';
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
import { userError, userMessage } from '../src/error-copy';
import { pruneExpiringMap } from './expiring-map';

const pending = new Map<string, { workspace: Workspace; plan: FilePlan; at: number }>();
const pendingOld = new Map<string, { workspace: Workspace; plan: OldCleanupPlan; at: number }>();
const displayed = new Map<string, { workspace: Workspace; at: number }>();

function freshWorkspace(revision: unknown, selection?: DataSelection, saved?: Workspace): Workspace {
  const workspace = managedWorkspace(ensureConfiguredWorkspace());
  if (typeof revision !== 'string') throw userError('errorWorkspaceRevisionChanged');
  if (selection) {
    const checked = displayed.get(revision);
    const before = saved ?? (checked && Date.now() - checked.at <= 15 * 60 * 1000 ? checked.workspace : undefined);
    if (!before || workspaceRevision(before) !== revision) throw userError('errorCheckExpired');
    if (selectionRevision(before, selection) !== selectionRevision(workspace, selection)) throw dependencyError(captureDependencies(before, selection));
  } else if (revision !== workspaceRevision(workspace)) throw userError('errorWorkspaceRevisionChanged');
  return workspace;
}

function assertOrganizationCurrent(workspace: Workspace): void {
  if (workspaceRevision(managedWorkspace(workspace)) !== workspaceRevision(workspace)) throw userError('errorOrganizationChanged');
}

function writeScope(workspace: Workspace, selection: DataSelection) {
  const dependencies = captureDependencies(workspace, selection);
  const labels = [...new Set(dependencies.labels.values())].slice(0, 3);
  return { sessionIds: [...dependencies.ids], label: labels.length ? userMessage('statusSessionList', { labels }) : userMessage('statusSelectedSessionSharedBody') };
}

function normalizeRequest(value: unknown): OperationRequest {
  const kinds: readonly OperationKind[] = ['sync', 'keep', 'archive', 'unarchive', 'delete', 'rename', 'star', 'unstar'];
  if (!isRecord(value) || !kinds.includes(value.kind as OperationKind) || !Array.isArray(value.sessionIds)
    || !Array.isArray(value.accountIds) || value.sessionIds.some((id) => typeof id !== 'string')
    || value.accountIds.some((id) => typeof id !== 'string') || value.sessionIds.length > 5000) throw userError('errorInvalidOperationParams');
  if (value.group !== undefined && !SESSION_GROUPS.includes(value.group as SessionGroup)) throw userError('errorInvalidSessionGroup');
  const choices: Record<string, string> = {};
  if (isRecord(value.titleSelections)) {
    for (const [id, scope] of Object.entries(value.titleSelections)) if (typeof scope === 'string') choices[id] = scope;
  }
  const contentSelections: Record<string, string> = {};
  if (isRecord(value.contentSelections)) {
    for (const [id, path] of Object.entries(value.contentSelections)) if (typeof path === 'string') contentSelections[id] = path;
  }
  return { group: (value.group ?? 'visible') as SessionGroup, kind: value.kind as OperationRequest['kind'], sessionIds: [...new Set(value.sessionIds as string[])],
    accountIds: [...new Set(value.accountIds as string[])], title: typeof value.title === 'string' ? value.title : undefined, titleSelections: choices, contentSelections };
}

function savePreview(workspace: Workspace, plan: FilePlan): string {
  pruneExpiringMap(pending, 10);
  const token = randomUUID();
  pending.set(token, { workspace, plan, at: Date.now() });
  return token;
}

export async function checkWorkspace(): Promise<WorkspaceView> {
  const desktop = await checkDesktopIdentity();
  const discovered = includeDesktopAccount(ensureConfiguredWorkspace(), desktop.identity);
  const emails = rememberIdentities(discovered.accounts, desktop.identity);
  const workspace = managedWorkspace(discovered);
  const revision = workspaceRevision(workspace);
  pruneExpiringMap(displayed, 4);
  displayed.set(revision, { workspace, at: Date.now() });
  return { checkedAt: new Date().toISOString(), revision, blockers: processBlockers(),
    identityState: desktop.state, skippedPaths: workspace.snapshot.skippedPaths,
    ...buildCatalog(workspace, emails, desktop.identity?.accountId) };
}

export function previewOperation(value: unknown, revision: unknown) {
  const workspace = freshWorkspace(revision);
  const request = normalizeRequest(value);
  if (request.kind === 'delete') throw userError('errorDeleteConfirmation');
  const plan = buildOperationPlan(workspace, request);
  return { ...plan.preview, token: savePreview(workspace, plan) };
}

export async function deleteSelected(value: unknown, revision: unknown, trash: (path: string) => Promise<void>) {
  if (!isRecord(value)) throw userError('errorInvalidDeleteParams');
  const request = normalizeRequest({ group: value.group, sessionIds: value.sessionIds, accountIds: value.accountIds, kind: 'delete' });
  const workspace = freshWorkspace(revision, request);
  const scope = writeScope(workspace, request);
  assertClaudeStopped(scope);
  const plan = buildOperationPlan(workspace, request);
  const result = await commitFilePlanWithTrash(workspace, plan, () => { assertClaudeStopped(scope); assertOrganizationCurrent(workspace); }, trash);
  return { result, workspace: await checkWorkspace() };
}

export async function applyOperation(token: unknown) {
  if (typeof token !== 'string') throw userError('errorPreviewRequired');
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry || Date.now() - entry.at > 15 * 60 * 1000) throw userError('errorPreviewExpired');
  const result = commitFilePlan(entry.workspace, entry.plan, () => { assertClaudeStopped(); assertOrganizationCurrent(entry.workspace); });
  return { result, workspace: await checkWorkspace() };
}

export function previewOldCopies(value: unknown, revision: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50 || value.some((id) => typeof id !== 'string')) throw userError('errorCleanupAccountsRequired');
  const workspace = freshWorkspace(revision, { accountIds: value as string[], oldCopies: true });
  const plan = planOldCleanup(workspace, value as string[]);
  if (!plan.items.length) return { token: '', items: [], accountIds: plan.accountIds, trashCount: 0, archivedToImport: 0 };
  pruneExpiringMap(pendingOld, 10);
  const token = randomUUID();
  pendingOld.set(token, { workspace, plan, at: Date.now() });
  return { token, items: plan.items, accountIds: plan.accountIds, trashCount: plan.removals.length, archivedToImport: plan.imports.length };
}

export async function cleanupOldCopies(token: unknown, trash: (path: string) => Promise<void>) {
  if (typeof token !== 'string' || !token) throw userError('errorOldCopyPreviewRequired');
  const saved = pendingOld.get(token);
  pendingOld.delete(token); // Single-use even when blocked; never retry Trash automatically.
  if (!saved || Date.now() - saved.at > 15 * 60 * 1000) throw userError('errorOldCopyPreviewExpired');
  const selection = { accountIds: saved.plan.accountIds, oldCopies: true };
  const workspace = freshWorkspace(workspaceRevision(saved.workspace), selection, saved.workspace);
  const scope = writeScope(workspace, selection);
  assertClaudeStopped(scope);
  // Relevant bytes have matched the confirmed list. Use fresh unrelated counts
  // and archive state as the baseline, not a stale whole-workspace snapshot.
  const plan = planOldCleanup(workspace, saved.plan.accountIds);
  const result = await executeOldCleanup(workspace, plan, trash,
    () => { assertClaudeStopped(scope); assertOrganizationCurrent(workspace); });
  return { result, workspace: await checkWorkspace() };
}

export function availableBackups() { return listBackups(ensureConfiguredWorkspace().baseDirectory); }

export function previewRestore(id: unknown, revision: unknown) {
  if (typeof id !== 'string') throw userError('errorBackupRequired');
  const workspace = freshWorkspace(revision);
  const plan = buildRestorePlan(workspace, id);
  return { kind: 'restore' as const, token: savePreview(workspace, plan), changes: changeViews(plan.changes),
    selected: [], accountIds: [...new Set(plan.changes.map((change) => change.path.split('/')[0]!))],
    conflicts: [], skipped: [], fileCount: plan.changes.length };
}
