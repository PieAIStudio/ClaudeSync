import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquireFileLock } from './storage';

it('refuses a live operation lock and preserves the owner bytes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  try {
    const path = join(root, '.lock');
    const release = acquireFileLock(path);
    expect(() => acquireFileLock(path)).toThrow('claudesync-message:errorOperationAlreadyRunning');
    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}\n`);
    release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('rejects malformed lock state instead of deleting a potentially live lock', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  try {
    const path = join(root, '.lock'); writeFileSync(path, 'bad owner');
    expect(() => acquireFileLock(path)).toThrow('claudesync-message:errorLockInvalid');
    expect(readFileSync(path, 'utf8')).toBe('bad owner');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('recovers a lock after its owning process has exited', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  try {
    const path = join(root, '.lock');
    const deadPid = execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim();
    writeFileSync(path, `${deadPid}\n`);
    const release = acquireFileLock(path);
    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}\n`);
    release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
