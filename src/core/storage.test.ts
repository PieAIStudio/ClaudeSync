import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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

it('recovers a lock whose PID now belongs to an unrelated live process', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  try {
    const path = join(root, '.lock');
    writeFileSync(path, `${unrelated.pid}\n`);
    const release = acquireFileLock(path);
    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}\n`);
    release();
  } finally { unrelated.kill(); rmSync(root, { recursive: true, force: true }); }
});

it('recovers a pre-boot lock even when its PID is alive', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  try {
    const path = join(root, '.lock');
    writeFileSync(path, `${process.pid}\n`);
    utimesSync(path, new Date(0), new Date(0));
    const release = acquireFileLock(path);
    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}\n`);
    release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('explains an inaccessible lock owner without exposing raw EPERM', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-lock-')));
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); });
  try {
    const path = join(root, '.lock');
    writeFileSync(path, '1234\n');
    expect(() => acquireFileLock(path)).toThrow('claudesync-message:errorLockOwnerUnavailable');
    expect(readFileSync(path, 'utf8')).toBe('1234\n');
  } finally { kill.mockRestore(); rmSync(root, { recursive: true, force: true }); }
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
