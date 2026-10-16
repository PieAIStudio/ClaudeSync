import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { isRecord, readRegularFile } from '../src/core/storage';
import type { DesktopIdentityState } from '../src/shared/contracts';

export interface AccountIdentity { accountId: string; email: string; organizationId?: string }
export interface DesktopIdentityCheck { state: DesktopIdentityState; identity?: AccountIdentity }

const UUID_PATTERN = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`, 'u');
const PROFILE_SCOPE = new RegExp(`^acct:(${UUID_PATTERN})\\|${UUID_PATTERN}:(${UUID_PATTERN}):https://api\\.anthropic\\.com:user:profile$`, 'u');
const SESSION_SCOPE = new RegExp(`^acct:(${UUID_PATTERN})\\|${UUID_PATTERN}:(${UUID_PATTERN}):https://api\\.anthropic\\.com:(.+)$`, 'u');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export function desktopDataPath(): string {
  const home = app.getPath('home');
  return process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude')
    : process.platform === 'win32' ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude')
      : join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude');
}

function readLogin(): { accountId: string; encryptedCache: string } | undefined {
  const raw: unknown = JSON.parse(readRegularFile(join(desktopDataPath(), 'config.json')).toString('utf8'));
  if (!isRecord(raw) || typeof raw.lastKnownAccountUuid !== 'string' || !UUID.test(raw.lastKnownAccountUuid)
    || typeof raw['oauth:tokenCacheV2'] !== 'string') return undefined;
  return { accountId: raw.lastKnownAccountUuid, encryptedCache: raw['oauth:tokenCacheV2'] };
}

function keychainPassword(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Claude Safe Storage'],
      { encoding: 'buffer', timeout: 3000, maxBuffer: 4096 }, (error, stdout) => {
        // Do not propagate child-process errors: they can contain captured credentials.
        if (error) { stdout.fill(0); reject(new Error('Desktop identity unavailable')); }
        else resolve(stdout);
      });
  });
}

function cachedToken(encrypted: Buffer, password: Buffer, accountId: string, permission: 'profile' | 'sessions', organizationId?: string): { token: string; organizationId: string; expiresAt: number } | undefined {
  let key: Buffer | undefined;
  let plain: Buffer | undefined;
  try {
    let end = password.length;
    while (end && (password[end - 1] === 10 || password[end - 1] === 13)) end--;
    key = pbkdf2Sync(password.subarray(0, end), 'saltysalt', 1003, 16, 'sha1');
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
    plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    const cache: unknown = JSON.parse(plain.toString('utf8'));
    if (!isRecord(cache)) return undefined;
    const candidates: Array<{ token: string; organizationId: string; expiresAt: number }> = [];
    for (const [scope, entry] of Object.entries(cache)) {
      const match = (permission === 'profile' ? PROFILE_SCOPE : SESSION_SCOPE).exec(scope);
      if (match?.[1] !== accountId || !isRecord(entry)
        || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()
        || typeof entry.token !== 'string' || !entry.token || /[\s\r\n]/u.test(entry.token)) continue;
      if (organizationId && match[2] !== organizationId) continue;
      if (permission === 'sessions') {
        const scopes = new Set(match[3]!.split(' '));
        if (!scopes.has('user:sessions:claude_code') || !scopes.has('user:profile')
          || [...scopes].some((value) => !['user:profile', 'user:inference', 'user:file_upload', 'user:sessions:claude_code'].includes(value))) continue;
      }
      candidates.push({ token: entry.token, organizationId: match[2]!, expiresAt: entry.expiresAt });
    }
    // A token confirms its own organization, not which of several organizations
    // Desktop selected. Fail closed when that choice is ambiguous.
    if (permission === 'profile' && new Set(candidates.map((candidate) => candidate.organizationId)).size > 1) return undefined;
    return candidates[0];
  } finally {
    password.fill(0); key?.fill(0); plain?.fill(0);
  }
}

// Main-process only; never expose this credential object through IPC or persistence.
export interface SessionCredential {
  token: string; accountId: string; organizationId: string; expiresAt: number;
  login: { accountId: string; encryptedCache: string };
}
export function assertSessionCredential(credential: SessionCredential): void {
  const current = readLogin();
  if (!current || current.accountId !== credential.accountId || current.encryptedCache !== credential.login.encryptedCache
    || credential.expiresAt <= Date.now()) throw new Error('Claude 当前登录或授权已变化，请重新检查云端 Code 会话。');
}
export async function readSessionCredential(identity: AccountIdentity): Promise<SessionCredential> {
  if (process.platform !== 'darwin' || !identity.organizationId) throw new Error('当前系统或登录资料暂不支持云端管理。');
  try {
    const login = readLogin();
    if (!login || login.accountId !== identity.accountId) throw new Error('unavailable');
    const encrypted = Buffer.from(login.encryptedCache, 'base64');
    if (encrypted.subarray(0, 3).toString('ascii') !== 'v10' || (encrypted.length - 3) % 16 !== 0) throw new Error('unavailable');
    const selected = cachedToken(encrypted, await keychainPassword(), identity.accountId, 'sessions', identity.organizationId);
    if (!selected) throw new Error('unavailable');
    const credential = { ...selected, accountId: identity.accountId, login };
    assertSessionCredential(credential);
    return credential;
  } catch { throw new Error('无法取得当前账号现有的 Code 云端授权。请在 Claude 登录后重新检查；程序不会创建或刷新授权。'); }
}

// Read-only, one profile request. No token refresh, login flow, retries or credential writes.
export async function checkDesktopIdentity(): Promise<DesktopIdentityCheck> {
  if (process.platform !== 'darwin') return { state: 'unsupported' };
  try {
    const before = readLogin();
    if (!before) return { state: 'unavailable' };
    const encrypted = Buffer.from(before.encryptedCache, 'base64');
    if (encrypted.subarray(0, 3).toString('ascii') !== 'v10' || encrypted.length <= 3 || (encrypted.length - 3) % 16 !== 0) return { state: 'unavailable' };
    const token = cachedToken(encrypted, await keychainPassword(), before.accountId, 'profile');
    if (!token) return { state: 'unavailable' };
    const ready = readLogin();
    if (!ready || ready.accountId !== before.accountId || ready.encryptedCache !== before.encryptedCache) return { state: 'changed' };
    const response = await fetch(PROFILE_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { state: 'unavailable' };
    const profile: unknown = await response.json();
    const after = readLogin();
    if (!after || after.accountId !== before.accountId || after.encryptedCache !== before.encryptedCache) return { state: 'changed' };
    if (!isRecord(profile) || !isRecord(profile.account) || profile.account.uuid !== before.accountId
      || typeof profile.account.email !== 'string' || !EMAIL.test(profile.account.email.trim())
      || !isRecord(profile.organization) || profile.organization.uuid !== token.organizationId) return { state: 'unavailable' };
    return { state: 'verified', identity: { accountId: before.accountId, email: profile.account.email.trim(), organizationId: token.organizationId } };
  } catch {
    // Keep local sessions available even if signed out, offline or denied Keychain access.
    return { state: 'unavailable' };
  }
}
