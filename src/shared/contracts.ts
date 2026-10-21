export type OperationKind = 'sync' | 'keep' | 'archive' | 'unarchive' | 'delete' | 'rename' | 'star' | 'unstar' | 'restore';
export type ChangeKind = 'add' | 'update' | 'title' | 'archive' | 'unarchive' | 'delete' | 'star' | 'unstar' | 'restore';

export interface AppInfo {
  version: string;
  configured: boolean;
  suggestedSessionRoot: string;
  suggestedProjectsRoot: string;
}

export const SESSION_GROUPS = ['visible', 'archived', 'scheduled', 'oldOrganization', 'deleted', 'unverified'] as const;
export type SessionGroup = (typeof SESSION_GROUPS)[number];

export interface SessionCopyView {
  scope: string;
  group: SessionGroup;
  title: string;
  project: string;
  updatedAt?: string;
  archived: boolean;
  eligible: boolean;
  manageable: boolean;
  starred: boolean;
  reasons: string[];
}

export interface AccountView {
  id: string;
  email?: string;
  scopes: string[];
  active: number;
  archived: number;
  total: number;
  eligible: number;
  copies: number;
  current: boolean;
  visible: number | null;
  organizationVerified: boolean;
  scheduled: number;
  oldCopies: number;
  deletedMarkers: number;
  unverified: number;
}

export interface SessionPresence {
  accountId: string;
  active: boolean;
  archived: boolean;
  eligible: boolean;
  copies: number;
  titles: string[];
  reasons: string[];
  records?: SessionCopyView[];
}

export interface SessionView {
  id: string;
  title: string;
  project: string;
  updatedAt?: string;
  starred: boolean;
  manageable: boolean;
  presence: SessionPresence[];
}

export type DesktopIdentityState = 'verified' | 'unavailable' | 'changed' | 'unsupported';

export interface WorkspaceView {
  checkedAt: string;
  revision: string;
  accounts: AccountView[];
  sessions: SessionView[];
  blockers: string[];
  skippedPaths: string[];
  identityState: DesktopIdentityState;
}

export interface OperationRequest {
  group?: SessionGroup;
  kind: Exclude<OperationKind, 'restore'>;
  sessionIds: string[];
  accountIds: string[];
  title?: string;
  titleSelections?: Record<string, string>;
  contentSelections?: Record<string, string>;
}

export interface DeleteRequest {
  group?: SessionGroup;
  sessionIds: string[];
  accountIds: string[];
}

export interface OldCopyItemView {
  sessionId: string;
  title: string;
  accountId: string;
  oldScope: string;
  currentHasCopy: boolean;
  action: 'trashDuplicate' | 'restoreArchived' | 'trashAfterRestore';
}
export interface OldCleanupPreview {
  token: string;
  items: OldCopyItemView[];
  accountIds: string[];
  trashCount: number;
  archivedToImport: number;
}
export interface OldCleanupResult {
  trashed: number;
  importedArchived: number;
  mainUnchanged: boolean;
  oldCopiesRemaining: number;
}

export interface CloudSessionView {
  id: string; title: string; status: 'active' | 'archived' | 'paused' | 'failed' | 'unknown';
  updatedAt?: string; deletable: boolean; blockedReason?: 'running' | 'unsupported';
}
export interface CloudWorkspaceView {
  revision: string; checkedAt: string; accountId: string; organizationId: string; email: string;
  sessions: CloudSessionView[]; limitReached: boolean;
}
export interface CloudDeleteResult {
  deleted: number; requested: number; issue?: string; workspace?: CloudWorkspaceView;
}

export interface ChangeView {
  sessionId: string;
  title: string;
  accountId: string;
  action: ChangeKind;
  copies: number;
}

export interface TitleConflictView {
  id: string;
  options: Array<{ scope: string; accountId: string; title: string }>;
}

export interface ProgressUpdateView {
  id: string; title: string; sourceAccountId: string; targetAccountId: string;
  sourceTurns?: number; targetTurns?: number; deltaTurns?: number; updatedAt?: string; selected: boolean;
}
export interface ProgressConflictView {
  id: string; title: string; resolved: boolean;
  options: Array<{ path: string; accountId: string; title: string; turns?: number; updatedAt?: string }>;
}

export interface OperationPreview {
  group?: SessionGroup;
  token: string;
  kind: OperationKind;
  changes: ChangeView[];
  selected: Array<{ id: string; title: string }>;
  accountIds: string[];
  conflicts: TitleConflictView[];
  progressUpdates?: ProgressUpdateView[];
  progressConflicts?: ProgressConflictView[];
  skipped: Array<{ id: string; title: string; reason: string }>;
  fileCount: number;
}

export interface BackupView {
  id: string;
  createdAt: string;
  operation: OperationKind;
  state: 'verified' | 'interrupted' | 'prepared';
  fileCount: number;
}

export interface ApplyResult {
  backup?: string;
  filesChanged: number;
  verified: boolean;
}

export interface ClaudeSyncApi {
  getInfo(): Promise<AppInfo>;
  chooseDirectory(): Promise<string | null>;
  configure(sessionRoot: string, projectsRoot: string): Promise<void>;
  check(): Promise<WorkspaceView>;
  preview(request: OperationRequest, revision: string): Promise<OperationPreview>;
  apply(token: string): Promise<{ result: ApplyResult; workspace: WorkspaceView }>;
  deleteSelected(request: DeleteRequest, revision: string): Promise<{ result: ApplyResult; workspace: WorkspaceView }>;
  previewOldCopies(accountIds: string[], revision: string): Promise<OldCleanupPreview>;
  cleanupOldCopies(token: string): Promise<{ result: OldCleanupResult; workspace: WorkspaceView }>;
  cloudSessions(): Promise<CloudWorkspaceView>;
  deleteCloudSessions(sessionIds: string[], revision: string): Promise<CloudDeleteResult>;
  backups(): Promise<BackupView[]>;
  previewRestore(id: string, revision: string): Promise<OperationPreview>;
  openBackups(): Promise<void>;
}
