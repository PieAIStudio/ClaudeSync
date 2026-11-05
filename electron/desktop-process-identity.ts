// Read-only macOS probe for external cleanup waiters. Never imports the app or credentials.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP_TEAM = 'Q6L2SF6YDW';
export const DESKTOP_BUNDLE = 'com.anthropic.claudefordesktop';
export interface ProcessPath { pid: number; executable: string }
export interface BundleIdentity { bundleId: string; version: string }
export interface SignatureInspector {
  bundle(root: string): BundleIdentity | null;
  verify(path: string, bundleId?: string): void;
}
export function desktopBundleRoots(executable: string): string[] {
  // Stock command paths are not application paths, even if arguments were appended.
  if (/^\/(?:usr\/)?s?bin\//u.test(executable)) return [];
  return [...executable.matchAll(/\.app\/Contents\//gu)].map((m) => executable.slice(0, m.index! + 4));
}
export function identifyDesktopProcesses(processes: ProcessPath[], inspector: SignatureInspector) {
  const bundles = new Map<string, BundleIdentity | null>();
  const verifiedExecutables = new Set<string>();
  return processes.flatMap((process) => {
    if (!Number.isSafeInteger(process.pid) || process.pid <= 0 || typeof process.executable !== 'string' || !process.executable.trim()) throw new Error('Malformed process inventory');
    if (!process.executable.startsWith('/')) {
      if (/^(Claude(?:[ (.-]|$)|ShipIt$)/u.test(process.executable)) throw new Error('Unresolved Desktop executable; no cleanup');
      return []; // macOS also reports short service names and defunct entries.
    }
    for (const root of desktopBundleRoots(process.executable)) {
      if (!bundles.has(root)) {
        const identity = inspector.bundle(root);
        if (identity?.bundleId === DESKTOP_BUNDLE) inspector.verify(root, DESKTOP_BUNDLE);
        else if (/^Claude(?:[ .-]|$)/u.test(basename(root))) throw new Error('Unverifiable Desktop bundle; no cleanup');
        bundles.set(root, identity);
      }
      const identity = bundles.get(root);
      if (identity?.bundleId !== DESKTOP_BUNDLE) continue;
      if (!verifiedExecutables.has(process.executable)) {
        inspector.verify(process.executable);
        verifiedExecutables.add(process.executable);
      }
      return [{ ...process, ...identity, bundleRoot: root, teamId: DESKTOP_TEAM }];
    }
    return [];
  });
}

export function nativeSignatureInspector(): SignatureInspector {
  if (process.platform !== 'darwin') throw new Error('macOS signature inspection required');
  const property = (root: string, key: string) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', `${root}/Contents/Info.plist`], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  return {
    bundle(root) {
      try { return { bundleId: property(root, 'CFBundleIdentifier'), version: property(root, 'CFBundleShortVersionString') }; }
      catch { return null; }
    },
    verify(path, bundleId) {
      const requirement = `anchor apple generic and certificate leaf[subject.OU] = "${DESKTOP_TEAM}"${bundleId ? ` and identifier "${bundleId}"` : ''}`;
      // '-' is the documented requirements-source stdin transport; no temporary files.
      execFileSync('/usr/bin/codesign', ['--verify', '--strict', '-R', '-', path], { input: requirement, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(input)) throw new Error('Malformed process inventory');
    console.log(JSON.stringify(identifyDesktopProcesses(input, nativeSignatureInspector())));
  } catch (error) {
    console.error('Desktop signature or process inventory could not be verified; no cleanup');
    console.error(error instanceof Error ? error.message : 'Unknown inspection error');
    process.exitCode = 1;
  }
}
