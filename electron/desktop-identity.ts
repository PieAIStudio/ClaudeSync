import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { isRecord, readRegularFile } from '../src/core/storage';
import type { DesktopIdentityState } from '../src/shared/contracts';
import { userError } from '../src/error-copy';

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

interface DesktopLogin { accountId: string; encryptedCache: string }
interface CachedToken { token: string; organizationId: string; expiresAt: number }
interface DesktopTokens { profiles: CachedToken[]; sessions: CachedToken[] }
let tokensInRun: { login: DesktopLogin; promise: Promise<DesktopTokens> } | undefined;
let identityInRun: { login: DesktopLogin; promise: Promise<DesktopIdentityCheck> } | undefined;

function sameLogin(left: DesktopLogin, right: DesktopLogin | undefined): boolean {
  return left.accountId === right?.accountId && left.encryptedCache === right.encryptedCache;
}

function readLogin(): DesktopLogin | undefined {
  const raw: unknown = JSON.parse(readRegularFile(join(desktopDataPath(), 'config.json')).toString('utf8'));
  if (!isRecord(raw) || typeof raw.lastKnownAccountUuid !== 'string' || !UUID.test(raw.lastKnownAccountUuid)
    || typeof raw['oauth:tokenCacheV2'] !== 'string') return undefined;
  return { accountId: raw.lastKnownAccountUuid, encryptedCache: raw['oauth:tokenCacheV2'] };
}

function keychainPassword(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Claude Safe Storage'],
      { encoding: 'buffer', timeout: 120000, maxBuffer: 4096 }, (error, stdout) => {
        // Do not propagate child-process errors: they can contain captured credentials.
        if (error) { stdout.fill(0); reject(new Error('Desktop identity unavailable')); }
        else resolve(stdout);
      });
  });
}

function decryptTokens(encrypted: Buffer, password: Buffer, accountId: string): DesktopTokens {
  let key: Buffer | undefined;
  let plain: Buffer | undefined;
  try {
    let end = password.length;
    while (end && (password[end - 1] === 10 || password[end - 1] === 13)) end--;
    key = pbkdf2Sync(password.subarray(0, end), 'saltysalt', 1003, 16, 'sha1');
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
    plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    const cache: unknown = JSON.parse(plain.toString('utf8'));
    const tokens: DesktopTokens = { profiles: [], sessions: [] };
    if (!isRecord(cache)) return tokens;
    for (const [scope, entry] of Object.entries(cache)) {
      const match = SESSION_SCOPE.exec(scope);
      if (match?.[1] !== accountId || !isRecord(entry)
        || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()
        || typeof entry.token !== 'string' || !entry.token || /[\s\r\n]/u.test(entry.token)) continue;
      const token = { token: entry.token, organizationId: match[2]!, expiresAt: entry.expiresAt };
      if (PROFILE_SCOPE.test(scope)) tokens.profiles.push(token);
      const scopes = new Set(match[3]!.split(' '));
      if (scopes.has('user:sessions:claude_code') && scopes.has('user:profile')
        && [...scopes].every((value) => ['user:profile', 'user:inference', 'user:file_upload', 'user:sessions:claude_code'].includes(value))) tokens.sessions.push(token);
    }
    return tokens;
  } finally {
    password.fill(0); key?.fill(0); plain?.fill(0);
  }
}

function readTokens(login: DesktopLogin): Promise<DesktopTokens> {
  if (!tokensInRun || !sameLogin(tokensInRun.login, login)) {
    const encrypted = Buffer.from(login.encryptedCache, 'base64');
    if (encrypted.subarray(0, 3).toString('ascii') !== 'v10' || encrypted.length <= 3 || (encrypted.length - 3) % 16 !== 0) throw new Error('unavailable');
    // Only whitelisted token fields survive decryption, in main-process memory.
    // Also remember a denied Keychain read until the login changes: do not nag.
    tokensInRun = { login, promise: keychainPassword().then((password) => decryptTokens(encrypted, password, login.accountId)) };
  }
  return tokensInRun.promise;
}

// Main-process only; never expose this credential object through IPC or persistence.
export interface SessionCredential {
  token: string; accountId: string; organizationId: string; expiresAt: number;
  login: { accountId: string; encryptedCache: string };
}
export function assertSessionCredential(credential: SessionCredential): void {
  const current = readLogin();
  if (!current || current.accountId !== credential.accountId || current.encryptedCache !== credential.login.encryptedCache
    || credential.expiresAt <= Date.now()) throw userError('errorCredentialChanged');
}
export async function readSessionCredential(identity: AccountIdentity): Promise<SessionCredential> {
  if (process.platform !== 'darwin' || !identity.organizationId) throw userError('errorCloudUnsupported');
  try {
    const login = readLogin();
    if (!login || login.accountId !== identity.accountId) throw new Error('unavailable');
    const selected = (await readTokens(login)).sessions.find((token) => token.organizationId === identity.organizationId && token.expiresAt > Date.now());
    if (!selected) throw new Error('unavailable');
    const credential = { ...selected, accountId: identity.accountId, login };
    assertSessionCredential(credential);
    return credential;
  } catch { throw userError('errorCloudCredentialUnavailable'); }
}

// Read-only, one successful profile verification per login snapshot and app run.
// No token refresh, login flow or credential writes.
async function verifyDesktopIdentity(before: DesktopLogin): Promise<DesktopIdentityCheck> {
  try {
    const profiles = (await readTokens(before)).profiles.filter((token) => token.expiresAt > Date.now());
    // An organization-scoped token does not identify Desktop's selection when
    // several organizations are live. Never guess from cache order.
    if (new Set(profiles.map((token) => token.organizationId)).size !== 1) return { state: 'unavailable' };
    const token = profiles[0]!;
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

export async function checkDesktopIdentity(): Promise<DesktopIdentityCheck> {
  if (process.platform !== 'darwin') return { state: 'unsupported' };
  try {
    const login = readLogin();
    if (!login) { tokensInRun = undefined; identityInRun = undefined; return { state: 'unavailable' }; }
    if (!identityInRun || !sameLogin(identityInRun.login, login)) {
      identityInRun = { login, promise: verifyDesktopIdentity(login) };
    }
    const pending = identityInRun;
    const result = await pending.promise;
    if (!sameLogin(login, readLogin())) return { state: 'changed' };
    // A transient network/profile failure can be retried, without another
    // Keychain prompt. Verified identity is reused until the login/cache changes.
    if (result.state !== 'verified' && identityInRun === pending) identityInRun = undefined;
    return result;
  } catch {
    tokensInRun = undefined; identityInRun = undefined;
    return { state: 'unavailable' };
  }
}
