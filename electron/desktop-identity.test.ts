import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ID_A, ID_B } from '../tests/fixture';

const mock = vi.hoisted(() => ({ root: '', keychain: vi.fn(), fetch: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => mock.root } }));
vi.mock('./keychain', () => ({ keychainPassword: mock.keychain }));
let assertSessionCredential: typeof import('./desktop-identity').assertSessionCredential;
let checkDesktopIdentity: typeof import('./desktop-identity').checkDesktopIdentity;
let readSessionCredential: typeof import('./desktop-identity').readSessionCredential;

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const PASSWORD = 'fixture-keychain-password';
const TOKEN = 'fixture-profile-only-token';
let passwordBytes: Buffer;
function configPath() { return join(mock.root, 'Library', 'Application Support', 'Claude', 'config.json'); }
function entryKey(id = ID_A, origin = 'https://api.anthropic.com', scope = 'user:profile', organizationId = ID_B) {
  return `acct:${id}|${ID_B}:${organizationId}:${origin}:${scope}`;
}
function saveLogin(cache: Record<string, unknown>, accountId = ID_A) {
  const key = pbkdf2Sync(PASSWORD, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update(JSON.stringify(cache)), cipher.final()]);
  key.fill(0);
  writeFileSync(configPath(), JSON.stringify({ lastKnownAccountUuid: accountId, 'oauth:tokenCacheV2': encrypted.toString('base64') }));
}
function validEntry() { return { token: TOKEN, expiresAt: Date.now() + 60000, refreshToken: 'fixture-refresh-token' }; }

beforeEach(async () => {
  vi.resetModules(); // Each test represents a fresh app run with no shared credentials.
  ({ assertSessionCredential, checkDesktopIdentity, readSessionCredential } = await import('./desktop-identity'));
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  mock.root = mkdtempSync(join(tmpdir(), 'claudesync-identity-test-'));
  mkdirSync(join(mock.root, 'Library', 'Application Support', 'Claude'), { recursive: true });
  passwordBytes = Buffer.from(`${PASSWORD}\n`);
  mock.keychain.mockReset().mockResolvedValue(passwordBytes);
  mock.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_A, email: ' desktop@example.com ', ignored: 'private-profile-data' }, organization: { uuid: ID_B } })));
  vi.stubGlobal('fetch', mock.fetch);
  saveLogin({ [entryKey()]: validEntry() });
});

it('allows human time for the Keychain prompt rather than treating it as a slow command', async () => {
  vi.useFakeTimers();
  try {
    mock.keychain.mockImplementation(() => new Promise((resolve) => { setTimeout(() => resolve(passwordBytes), 10000); }));
    const check = checkDesktopIdentity();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await check).toMatchObject({ state: 'verified' });
    expect(mock.keychain).toHaveBeenCalledExactlyOnceWith(); // No prompt deadline is passed to the native adapter.
  } finally { vi.useRealTimers(); }
});

it('shares one verification and Keychain read across refreshes and cloud actions until login or org changes', async () => {
  const sessions = 'user:profile user:sessions:claude_code';
  saveLogin({ [entryKey()]: validEntry(), [entryKey(ID_A, 'https://api.anthropic.com', sessions)]: validEntry() });
  const [first, second] = await Promise.all([checkDesktopIdentity(), checkDesktopIdentity()]);
  expect(first).toEqual(second);
  expect(first.state).toBe('verified');
  await checkDesktopIdentity();
  await readSessionCredential(first.identity!);
  await readSessionCredential(first.identity!);
  expect(mock.keychain).toHaveBeenCalledTimes(1);
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  saveLogin({ [entryKey(ID_A, 'https://api.anthropic.com', 'user:profile', ID_A)]: validEntry() });
  mock.keychain.mockImplementation(async () => Buffer.from(PASSWORD));
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_A, email: 'desktop@example.com' }, organization: { uuid: ID_A } })));
  expect(await checkDesktopIdentity()).toMatchObject({ state: 'verified', identity: { organizationId: ID_A } });
  expect(mock.keychain).toHaveBeenCalledTimes(2);
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  saveLogin({ [entryKey(ID_B)]: validEntry() }, ID_B);
  mock.fetch.mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_B, email: 'other@example.com' }, organization: { uuid: ID_B } })));
  expect(await checkDesktopIdentity()).toMatchObject({ state: 'verified', identity: { accountId: ID_B } });
  expect(mock.keychain).toHaveBeenCalledTimes(3);
  expect(mock.fetch).toHaveBeenCalledTimes(3);
});

it('does not guess Desktop organization when several current-account profile organizations are cached', async () => {
  saveLogin({ [entryKey()]: validEntry(), [entryKey(ID_A, 'https://api.anthropic.com', 'user:profile', ID_A)]: validEntry() });
  expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
  expect(mock.fetch).not.toHaveBeenCalled();
});

it('selects cloud session permission only for the verified account and organization, never using profile-only credentials', async () => {
  const scope = 'user:inference user:file_upload user:profile user:sessions:claude_code';
  saveLogin({
    [entryKey()]: validEntry(),
    [entryKey(ID_B, 'https://api.anthropic.com', scope)]: { ...validEntry(), token: 'other-account' },
    [entryKey(ID_A, 'https://api.anthropic.com', scope, ID_A)]: { ...validEntry(), token: 'other-organization' },
    [entryKey(ID_A, 'https://api.anthropic.com', scope)]: { ...validEntry(), token: 'fixture-session-token' },
  });
  const credential = await readSessionCredential({ accountId: ID_A, email: 'desktop@example.com', organizationId: ID_B });
  expect(credential).toMatchObject({ token: 'fixture-session-token', accountId: ID_A, organizationId: ID_B });
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
  saveLogin({});
  expect(() => assertSessionCredential(credential)).toThrow('claudesync-message:errorCredentialChanged');
});

it('refuses missing session scope and unknown wider permissions without credentials in its error', async () => {
  saveLogin({ [entryKey()]: validEntry(), [entryKey(ID_A, 'https://api.anthropic.com', 'user:profile user:sessions:claude_code user:admin')]: { ...validEntry(), token: 'fixture-secret-wider' } });
  await expect(readSessionCredential({ accountId: ID_A, email: 'desktop@example.com', organizationId: ID_B })).rejects.toThrow('claudesync-message:errorCloudCredentialUnavailable');
  expect(mock.fetch).not.toHaveBeenCalled();
});
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(process, 'platform', platform); rmSync(mock.root, { recursive: true, force: true }); });

it('uses the current Desktop profile-only token in one fixed-origin read and returns verified account, email and organization', async () => {
  saveLogin({
    [entryKey(ID_B)]: { ...validEntry(), token: 'fixture-other-account-token' },
    [entryKey(ID_A, 'https://other.example')]: { ...validEntry(), token: 'fixture-other-origin-token' },
    [entryKey(ID_A, 'https://api.anthropic.com', 'user:profile user:inference')]: { ...validEntry(), token: 'fixture-broad-token' },
    [entryKey()]: validEntry(),
  });
  writeFileSync(join(mock.root, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ID_B, emailAddress: 'stale-cli@example.com' } }));
  expect(await checkDesktopIdentity()).toEqual({ state: 'verified', identity: { accountId: ID_A, email: 'desktop@example.com', organizationId: ID_B } });
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  expect(mock.fetch).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/profile', expect.objectContaining({
    method: 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
  }));
  expect(mock.keychain).toHaveBeenCalledExactlyOnceWith();
  expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
});

it.each(['signed out', 'expired', 'other account', 'other origin', 'broader scope', 'invalid expiry', 'invalid token'])(
  'does not make a profile request or refresh credentials when %s', async (scenario) => {
    let key = entryKey();
    let entry: Record<string, unknown> = validEntry();
    if (scenario === 'expired') entry.expiresAt = 0;
    if (scenario === 'other account') key = entryKey(ID_B);
    if (scenario === 'other origin') key = entryKey(ID_A, 'https://other.example');
    if (scenario === 'broader scope') key = entryKey(ID_A, 'https://api.anthropic.com', 'user:profile user:inference');
    if (scenario === 'invalid expiry') entry.expiresAt = 'never';
    if (scenario === 'invalid token') entry.token = 'bad\nheader';
    saveLogin(scenario === 'signed out' ? {} : { [key]: entry });
    expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
    expect(mock.fetch).not.toHaveBeenCalled();
    expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
  },
);

it.each(['keychain denied', 'offline', 'unauthorized', 'malformed profile', 'wrong UUID', 'wrong organization', 'missing email'])(
  'returns a safe unavailable status with no leaked error or fallback identity when %s', async (scenario) => {
    if (scenario === 'keychain denied') mock.keychain.mockRejectedValue(new Error('fixture-secret-in-error'));
    if (scenario === 'offline') mock.fetch.mockRejectedValue(new Error('fixture-secret-in-error'));
    if (scenario === 'unauthorized') mock.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    if (scenario === 'malformed profile') mock.fetch.mockResolvedValue(new Response('not JSON'));
    if (scenario === 'wrong UUID') mock.fetch.mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_B, email: 'other@example.com' } })));
    if (scenario === 'wrong organization') mock.fetch.mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_A, email: 'desktop@example.com' }, organization: { uuid: ID_A } })));
    if (scenario === 'missing email') mock.fetch.mockResolvedValue(new Response(JSON.stringify({ account: { uuid: ID_A, email_address: 'wrong-field@example.com' } })));
    expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
    expect(mock.fetch.mock.calls.length).toBeLessThanOrEqual(1);
  },
);

it('rejects a result if the user switches accounts or logs out during the profile request', async () => {
  mock.fetch.mockImplementation(async () => {
    saveLogin({ [entryKey(ID_B)]: validEntry() }, ID_B);
    return new Response(JSON.stringify({ account: { uuid: ID_A, email: 'old@example.com' } }));
  });
  expect(await checkDesktopIdentity()).toEqual({ state: 'changed' });
  saveLogin({ [entryKey()]: validEntry() });
  mock.keychain.mockImplementation(async () => Buffer.from(PASSWORD));
  mock.fetch.mockImplementation(async () => {
    saveLogin({});
    return new Response(JSON.stringify({ account: { uuid: ID_A, email: 'old@example.com' } }));
  });
  expect(await checkDesktopIdentity()).toEqual({ state: 'changed' });
});

it('checks again after Keychain access so a switch prevents even the obsolete profile request', async () => {
  mock.keychain.mockImplementation(async () => {
    saveLogin({ [entryKey(ID_B)]: validEntry() }, ID_B);
    return passwordBytes;
  });
  expect(await checkDesktopIdentity()).toEqual({ state: 'changed' });
  expect(mock.fetch).not.toHaveBeenCalled();
});

it('does not request Keychain access for missing settings, unknown envelopes or unsupported systems', async () => {
  writeFileSync(configPath(), JSON.stringify({ lastKnownAccountUuid: ID_A, 'oauth:tokenCacheV2': 'unknown' }));
  expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
  rmSync(configPath());
  expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
  Object.defineProperty(process, 'platform', { value: 'linux' });
  expect(await checkDesktopIdentity()).toEqual({ state: 'unsupported' });
  expect(mock.keychain).not.toHaveBeenCalled();
  expect(mock.fetch).not.toHaveBeenCalled();
});
