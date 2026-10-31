import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@napi-rs/keyring', () => ({ findCredentialsAsync: native.find }));
import { keychainPassword } from './keychain';

it('does not delegate the Keychain trust boundary to the security executable', () => {
  for (const file of ['./desktop-identity.ts', './keychain.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source.includes('/usr/bin/security')).toBe(false);
    expect(source.includes('node:child_process')).toBe(false);
  }
});

it('reads only the fixed service asynchronously in process and returns a wipeable buffer', async () => {
  const entry = { account: 'fixture-only-account', password: 'fixture-only-password' };
  const result = [entry];
  native.find.mockReset().mockResolvedValue(result);
  const password = await keychainPassword();
  expect(native.find).toHaveBeenCalledExactlyOnceWith('Claude Safe Storage');
  expect(password).toEqual(Buffer.from('fixture-only-password'));
  expect(entry).toEqual({ account: '', password: '' });
  expect(result).toEqual([]);
  password.fill(0);
});

it.each(['denied', 'absent', 'ambiguous'])('returns only a nonsecret unavailable error when native access is %s', async (scenario) => {
  native.find.mockReset();
  if (scenario === 'denied') native.find.mockRejectedValue(new Error('fixture-private-native-detail'));
  else native.find.mockResolvedValue(scenario === 'absent' ? [] : [
    { account: 'fixture-1', password: 'fixture-private-1' }, { account: 'fixture-2', password: 'fixture-private-2' },
  ]);
  await expect(keychainPassword()).rejects.toThrow(/^Desktop identity unavailable$/u);
});
