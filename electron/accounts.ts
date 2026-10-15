import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { loadWorkspace } from '../src/core/workspace';
import { accountIdForScope } from '../src/core/account-identity';
import { isRecord, readRegularFile, writeOwnedFile } from '../src/core/storage';
import type { Account } from '../src/core/types';
import { desktopDataPath } from './desktop-identity';
import type { AccountIdentity } from './desktop-identity';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
type IdentityEmails = Record<string, string>;
type SavedIdentity = string | { email: string; organizationId: string };
export function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function identityMapPath(): string {
  return join(app.getPath('userData'), 'account-identities.json');
}

function readIdentities(): Record<string, SavedIdentity> {
  try {
    const raw: unknown = JSON.parse(readRegularFile(identityMapPath()).toString('utf8'));
    if (!isRecord(raw)) return {};
    const identities: Record<string, SavedIdentity> = {};
    for (const [accountId, value] of Object.entries(raw)) {
      if (!UUID.test(accountId)) continue;
      if (typeof value === 'string' && EMAIL.test(value)) identities[accountId] = value;
      else if (isRecord(value) && typeof value.email === 'string' && EMAIL.test(value.email)
        && typeof value.organizationId === 'string' && UUID.test(value.organizationId)) identities[accountId] = { email: value.email, organizationId: value.organizationId };
    }
    return identities;
  } catch {
    return {};
  }
}

function cliIdentity(): AccountIdentity | undefined {
  try {
    const raw: unknown = JSON.parse(readRegularFile(join(app.getPath('home'), '.claude.json')).toString('utf8'));
    if (!isRecord(raw) || !isRecord(raw.oauthAccount)) return undefined;
    const accountId = raw.oauthAccount.accountUuid;
    const email = raw.oauthAccount.emailAddress;
    if (typeof accountId !== 'string' || !UUID.test(accountId)
      || typeof email !== 'string' || !EMAIL.test(email.trim())) return undefined;
    return { accountId, email: email.trim() };
  } catch {
    return undefined;
  }
}

export function rememberIdentities(accounts: Account[], desktop?: AccountIdentity): IdentityEmails {
  const identities = readIdentities();
  let changed = false;
  // CLI metadata can identify a historical account; it never establishes Desktop's current login.
  const cli = cliIdentity();
  for (const identity of [cli && !identities[cli.accountId] ? cli : undefined, desktop]) {
    // A verified Desktop profile also pins the organization when first seen in
    // the cloud view, even if this account has no configured local sessions yet.
    if (!identity || (identity !== desktop && !accounts.some((account) => accountIdForScope(account.scope) === identity.accountId))) continue;
    const previous = identities[identity.accountId];
    const organizationId = identity.organizationId ?? (typeof previous === 'object' ? previous.organizationId : undefined);
    const next: SavedIdentity = organizationId ? { email: identity.email, organizationId } : identity.email;
    if (JSON.stringify(previous) !== JSON.stringify(next)) { identities[identity.accountId] = next; changed = true; }
  }
  if (changed) writeOwnedFile(identityMapPath(), Buffer.from(`${JSON.stringify(identities, null, 2)}\n`, 'utf8'));
  return Object.fromEntries(Object.entries(identities).map(([id, value]) => [id, typeof value === 'string' ? value : value.email]));
}

export function managedWorkspace(workspace: ReturnType<typeof loadWorkspace>): ReturnType<typeof loadWorkspace> {
  const identities = readIdentities();
  // Keep the full inventory. Organization verification selects visibility and
  // write targets, not which old copies the user is allowed to inspect.
  const verifiedOrganizations = Object.fromEntries(Object.entries(identities)
    .filter((entry): entry is [string, { email: string; organizationId: string }] => typeof entry[1] === 'object')
    .map(([id, identity]) => [id, identity.organizationId]));
  return { ...workspace, verifiedOrganizations };
}

function accountsForConfiguration(sessionRoot: string, discovered: Account[]): Account[] {
  const path = configPath();
  if (!existsSync(path)) return discovered;
  try {
    const raw: unknown = JSON.parse(readRegularFile(path).toString('utf8'));
    if (!isRecord(raw) || raw.session_root !== sessionRoot || !Array.isArray(raw.accounts)) return discovered;
    const priorScopes = new Set(raw.accounts
      .filter(isRecord)
      .map((account) => account.scope)
      .filter((scope): scope is string => typeof scope === 'string'));
    return discovered.filter((account) => priorScopes.has(account.scope));
  } catch {
    return discovered;
  }
}

function defaultRoots(): { sessionRoot: string; projectsRoot: string } {
  const home = app.getPath('home');
  const desktopData = desktopDataPath();
  const candidates = [
    join(desktopData, 'claude-code-sessions'),
    join(desktopData, 'claude-code', 'sessions'),
    join(desktopData, 'sessions'),
  ];
  const sessionRoot = candidates.find((candidate) => {
    try { return lstatSync(candidate).isDirectory(); } catch { return false; }
  }) ?? candidates[0]!;
  const configOverride = process.env.CLAUDE_CONFIG_DIR?.trim();
  return {
    sessionRoot,
    projectsRoot: configOverride ? join(configOverride, 'projects') : join(home, '.claude', 'projects'),
  };
}

function discoverAccounts(sessionRoot: string, currentId?: string): Account[] {
  const root = resolve(sessionRoot);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || realpathSync(root) !== root) throw new Error('会话索引根目录必须是普通文件夹，不能通过符号链接。');
  const scopes: string[] = [];
  for (const account of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!account.isDirectory() || !UUID.test(account.name) || (currentId && account.name !== currentId)) continue;
    const accountPath = join(root, account.name);
    if (realpathSync(accountPath) !== accountPath) continue;
    for (const organization of readdirSync(accountPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!organization.isDirectory() || !UUID.test(organization.name)) continue;
      const organizationPath = join(accountPath, organization.name);
      if (realpathSync(organizationPath) !== organizationPath) continue;
      scopes.push(`${account.name}/${organization.name}`);
    }
  }
  return scopes.map((scope, index) => ({ label: `账号 ${index + 1}`, scope }));
}

export function ensureConfiguredWorkspace(): ReturnType<typeof loadWorkspace> {
  const target = configPath();
  if (!existsSync(target)) throw new Error('还没有设置会话文件夹和正文文件夹，请先完成设置。');
  return loadWorkspace(target);
}

export function includeDesktopAccount(workspace: ReturnType<typeof loadWorkspace>, identity?: AccountIdentity): ReturnType<typeof loadWorkspace> {
  if (!identity) return workspace;
  const known = new Set(workspace.accounts.map((account) => account.scope));
  const additions = discoverAccounts(workspace.root, identity.accountId).filter((account) => !known.has(account.scope));
  if (!additions.length) return workspace;
  const raw = JSON.parse(workspace.configRaw.toString('utf8'));
  raw.accounts = [...workspace.accounts, ...additions.map((account) => ({ ...account, label: `Account ${account.scope}` }))];
  const target = configPath();
  writeOwnedFile(join(app.getPath('userData'), 'backups', `config-${Date.now()}.json`), workspace.configRaw);
  writeOwnedFile(target, Buffer.from(`${JSON.stringify(raw, null, 2)}\n`, 'utf8'));
  try { return loadWorkspace(target); }
  catch (error) { writeOwnedFile(target, workspace.configRaw); throw error; }
}

export function savedRoots(): { sessionRoot: string; projectsRoot: string } {
  const fallback = defaultRoots();
  const target = configPath();
  if (!existsSync(target)) return fallback;
  try {
    const saved: unknown = JSON.parse(readRegularFile(target).toString('utf8'));
    if (isRecord(saved) && typeof saved.session_root === 'string' && typeof saved.projects_root === 'string') {
      return { sessionRoot: saved.session_root, projectsRoot: saved.projects_root };
    }
  } catch { /* The read-only check will report malformed saved settings. */ }
  return fallback;
}


export function configureFolders(sessionRootValue: unknown, projectsRootValue: unknown): void {
  if (typeof sessionRootValue !== 'string' || typeof projectsRootValue !== 'string') throw new Error('请选择两个文件夹。');
  const sessionRoot = resolve(sessionRootValue);
  const projectsRoot = resolve(projectsRootValue);
  const accounts = accountsForConfiguration(sessionRoot, discoverAccounts(sessionRoot));
  if (!accounts.length) throw new Error('没有找到 Claude 登录账号目录。');
  if (accounts.length > 50) throw new Error('账号目录过多，请缩小范围。');
  const info = lstatSync(projectsRoot);
  if (!info.isDirectory() || realpathSync(projectsRoot) !== projectsRoot) throw new Error('正文目录必须是普通文件夹。');
  if (existsSync(configPath())) {
    const previous = readRegularFile(configPath());
    writeOwnedFile(join(app.getPath('userData'), 'backups', `config-${Date.now()}.json`), previous);
  }
  writeOwnedFile(configPath(), Buffer.from(`${JSON.stringify({version: 1, session_root: sessionRoot, projects_root: projectsRoot, accounts}, null, 2)}\n`));
  rememberIdentities(accounts);
}
