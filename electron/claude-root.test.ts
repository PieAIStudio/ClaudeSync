import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ID_A, ID_B, SCOPE_A, temporaryFixture } from '../tests/fixture';
const native = vi.hoisted(() => ({ home: '', userData: '', setPath: vi.fn(), keychain: vi.fn(), fetch: vi.fn() }));
vi.mock('electron', () => ({ app: {
  getPath: (name: string) => name === 'home' ? native.home : native.userData,
  setPath: native.setPath,
} }));
vi.mock('./keychain', () => ({ keychainPassword: native.keychain }));
import { assertClaudeDataPath, claudeRootOverride, initializeClaudeRoot } from './claude-root';
import { configureFolders, ensureConfiguredWorkspace, rememberIdentities, savedRoots } from './accounts';
import { checkDesktopIdentity, desktopDataPath } from './desktop-identity';
let fixture: string, home: string;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  fixture = temporaryFixture(); home = join(fixture, 'profile-home'); mkdirSync(home);
  native.home = join(fixture, 'default-home'); mkdirSync(native.home); native.userData = fixture;
  native.setPath.mockReset().mockImplementation((_name: string, value: string) => { native.home = value; });
  initializeClaudeRoot({ setPath: native.setPath }, [], {});
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  native.keychain.mockReset().mockRejectedValue(new Error('Fixture forbids Keychain'));
  native.fetch.mockReset().mockRejectedValue(new Error('Fixture forbids network')); vi.stubGlobal('fetch', native.fetch);
});
afterEach(() => {
  initializeClaudeRoot({ setPath: native.setPath }, [], {}); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  Object.defineProperty(process, 'platform', originalPlatform); rmSync(fixture, { recursive: true, force: true });
});
it('leaves native home, saved absolute roots and CLI config override unchanged without the option', () => {
  expect(native.setPath).not.toHaveBeenCalled(); expect(claudeRootOverride()).toBeUndefined();
  expect(savedRoots()).toEqual({ sessionRoot: join(fixture, 'session-root'), projectsRoot: join(fixture, 'projects') });
  unlinkSync(join(fixture, 'config.json')); vi.stubEnv('CLAUDE_CONFIG_DIR', join(fixture, 'original-cli-config'));
  expect(savedRoots().projectsRoot).toBe(join(fixture, 'original-cli-config', 'projects'));
  expect(desktopDataPath()).toBe(join(native.home, 'Library', 'Application Support', 'Claude'));
});
it.each(['argument', 'equals', 'environment'])('sets canonical native home from the %s launch option', (form) => {
  const args = form === 'argument' ? ['--claude-root', home] : form === 'equals' ? [`--claude-root=${home}`] : [];
  expect(initializeClaudeRoot({ setPath: native.setPath }, args, { CLAUDESYNC_CLAUDE_ROOT: home })).toBe(realpathSync(home));
  expect(native.setPath).toHaveBeenCalledExactlyOnceWith('home', home); expect(claudeRootOverride()).toBe(home);
});
it('gives the explicit argument precedence over the environment', () => {
  initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', home], { CLAUDESYNC_CLAUDE_ROOT: fixture });
  expect(native.home).toBe(home);
});
it.each([['--claude-root'], ['--claude-root='], ['--claude-root', '--other'], ['--claude-root', '.', '--claude-root', '.']])('rejects malformed or duplicate launch arguments %j', (...args) => {
  expect(() => initializeClaudeRoot({ setPath: native.setPath }, args, {})).toThrow(); expect(native.setPath).not.toHaveBeenCalled();
});
it('rejects missing roots and regular files without falling back to real home', () => {
  for (const path of [join(fixture, 'missing'), join(fixture, 'config.json')]) {
    expect(() => initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', path], {})).toThrow();
  }
  expect(native.setPath).not.toHaveBeenCalled();
});
it.each(['darwin', 'win32', 'linux'])('pins Desktop/CLI paths on %s even when host path environments point elsewhere', (platform) => {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.stubEnv('APPDATA', fixture); vi.stubEnv('XDG_CONFIG_HOME', fixture); vi.stubEnv('CLAUDE_CONFIG_DIR', fixture);
  initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', home], {});
  const desktop = platform === 'darwin' ? ['Library', 'Application Support', 'Claude'] : platform === 'win32' ? ['AppData', 'Roaming', 'Claude'] : ['.config', 'Claude'];
  expect(desktopDataPath()).toBe(join(home, ...desktop));
  expect(savedRoots()).toEqual({ sessionRoot: join(home, ...desktop, 'claude-code-sessions'), projectsRoot: join(home, '.claude', 'projects') });
});
it('rejects outside, sibling-prefix and symlinked paths before configured data is loaded', () => {
  initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', home], {});
  expect(assertClaudeDataPath(join(home, 'new', 'projects'))).toBe(join(home, 'new', 'projects'));
  for (const path of [fixture, home + '-sibling', join(home, '..', 'projects')]) expect(() => assertClaudeDataPath(path)).toThrow('outside --claude-root');
  symlinkSync(fixture, join(home, 'escape'), 'dir'); expect(() => assertClaudeDataPath(join(home, 'escape', 'projects'))).toThrow('symlink');
  expect(() => ensureConfiguredWorkspace()).toThrow('outside --claude-root');
  expect(() => configureFolders(join(fixture, 'session-root'), join(fixture, 'projects'))).toThrow('outside --claude-root');
});
it('loads a valid configured workspace inside the explicit root', () => {
  initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', fixture], {});
  expect(ensureConfiguredWorkspace().root).toBe(join(fixture, 'session-root'));
});
it('reads only the selected CLI identity and never reaches the default Desktop cache, Keychain or network', async () => {
  const defaultHome = native.home;
  const desktop = join(defaultHome, 'Library', 'Application Support', 'Claude'); mkdirSync(desktop, { recursive: true });
  writeFileSync(join(desktop, 'config.json'), JSON.stringify({ lastKnownAccountUuid: ID_B,
    'oauth:tokenCacheV2': Buffer.concat([Buffer.from('v10'), Buffer.alloc(16)]).toString('base64') }));
  writeFileSync(join(defaultHome, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ID_B, emailAddress: 'default@fixture.invalid' } }));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ID_A, emailAddress: 'selected@fixture.invalid' } }));
  initializeClaudeRoot({ setPath: native.setPath }, ['--claude-root', home], {});
  expect(rememberIdentities([{ scope: SCOPE_A, label: 'Fixture' }])[ID_A]).toBe('selected@fixture.invalid');
  expect(await checkDesktopIdentity()).toEqual({ state: 'unavailable' });
  expect(native.keychain).not.toHaveBeenCalled(); expect(native.fetch).not.toHaveBeenCalled();
});
