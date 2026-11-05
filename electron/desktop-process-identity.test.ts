import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_BUNDLE, DESKTOP_TEAM, desktopBundleRoots, identifyDesktopProcesses, type SignatureInspector } from './desktop-process-identity';
const bundle = { bundleId: DESKTOP_BUNDLE, version: 'fixture-update' };
function inspector(): SignatureInspector { return { bundle: vi.fn(() => bundle), verify: vi.fn() }; }
describe('signed Desktop writer identity', () => {
  it('accepts an updated app path by signed bundle identity, not location/name', () => {
    const probe = inspector();
    const executable = '/private/updates/New Build.app/Contents/MacOS/Claude';
    const result = identifyDesktopProcesses([{ pid: 42, executable }], probe);
    expect(result).toEqual([{ pid: 42, executable, ...bundle, bundleRoot: '/private/updates/New Build.app', teamId: DESKTOP_TEAM }]);
    expect(probe.verify).toHaveBeenCalledWith('/private/updates/New Build.app', DESKTOP_BUNDLE);
    expect(probe.verify).toHaveBeenCalledWith(executable);
  });
  it('counts the signed updater as an open Desktop writer', () => {
    const executable = '/Applications/Claude.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt';
    expect(identifyDesktopProcesses([{ pid: 43, executable }], inspector())).toHaveLength(1);
  });
  it('never trusts a team string without signature verification', () => {
    const probe = inspector(); probe.verify = () => { throw new Error('wrong team/signature'); };
    expect(() => identifyDesktopProcesses([{ pid: 42, executable: '/Applications/Claude.app/Contents/MacOS/Claude' }], probe)).toThrow();
  });
  it('rejects an unsigned child even when the outer app verifies', () => {
    const probe = inspector(); probe.verify = (_path, id) => { if (!id) throw new Error('unsigned child'); };
    expect(() => identifyDesktopProcesses([{ pid: 43, executable: '/Applications/Claude.app/Contents/Helpers/new-helper' }], probe)).toThrow();
  });
  it('rejects unreadable or impostor Claude bundles', () => {
    for (const identity of [null, { bundleId: 'fixture.impostor', version: '1' }]) {
      const probe = inspector(); probe.bundle = () => identity;
      expect(() => identifyDesktopProcesses([{ pid: 42, executable: '/Applications/Claude.app/Contents/MacOS/Claude' }], probe)).toThrow();
    }
  });
  it('ignores unrelated bundles and argument substrings', () => {
    const probe = inspector(); probe.bundle = () => ({ bundleId: 'fixture.other', version: '1' });
    expect(identifyDesktopProcesses([{ pid: 1, executable: '/Applications/Other.app/Contents/MacOS/Other' }], probe)).toEqual([]);
    expect(desktopBundleRoots('/bin/echo /Applications/Claude.app/Contents/MacOS/Claude')).toEqual([]);
  });
  it('ignores OS short service names but fails closed on unresolved Desktop names', () => {
    const probe = inspector();
    expect(identifyDesktopProcesses([{ pid: 1, executable: 'autofsd' }, { pid: 2, executable: '<defunct>' }], probe)).toEqual([]);
    expect(() => identifyDesktopProcesses([{ pid: 3, executable: 'Claude' }], probe)).toThrow('Unresolved Desktop');
  });
  it('rejects malformed process inventory', () => {
    expect(() => identifyDesktopProcesses([{ pid: -1, executable: '/bad' }], inspector())).toThrow();
  });
  it('empty inventories remain closed; caches only verified identities per scan', () => {
    expect(identifyDesktopProcesses([], inspector())).toEqual([]);
    const probe = inspector(), executable = '/Applications/Claude.app/Contents/MacOS/Claude';
    expect(identifyDesktopProcesses([{ pid: 1, executable }, { pid: 2, executable }], probe)).toHaveLength(2);
    expect(probe.verify).toHaveBeenCalledTimes(2);
  });
});
