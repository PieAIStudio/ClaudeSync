export type TitleOrigin = 'manual' | 'auto' | 'legacy_generated';

export interface Account {
  label: string;
  scope: string;
}

export type VerifiedOrganizations = Readonly<Record<string, string>>;

export interface VisibilityWorkspace {
  verifiedOrganizations?: VerifiedOrganizations;
  // Only explicit retirement evidence may authorize old-copy classification.
  retiredOrganizationScopes?: readonly string[];
  accounts: Account[];
  snapshot: { files: Map<string, Buffer> };
}

export interface SessionRecord extends Record<string, unknown> {
  sessionId: string;
  cliSessionId?: string;
  title?: string;
  titleSource?: string;
  isArchived?: boolean;
  isStarred?: boolean;
  completedTurns?: number;
}

export interface SessionEntry {
  account: Account;
  path: string;
  data: SessionRecord;
  eligible: boolean;
  reason?: string;
  raw?: Buffer;
  archived?: boolean;
  syncIssue?: string;
}

export interface PlannedAddition {
  source: SessionEntry;
  target: Account;
  targetPath: string;
  data: SessionRecord;
}

export interface TitleAction {
  status: 'same' | 'safe' | 'normalize' | 'conflict' | 'auto_difference' | 'selected_source' | 'selected_target';
  cliSessionId: string;
  source: SessionEntry;
  target: SessionEntry;
  notes: string[];
  data?: SessionRecord;
}

export interface SyncPlan {
  additions: PlannedAddition[];
  titleActions: TitleAction[];
  skipped?: Array<{ source: Account; target: Account; title: string; reason: string }>;
}
