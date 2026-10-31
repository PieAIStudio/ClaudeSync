import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../src/core/storage';
import { messageList, userMessage } from '../src/error-copy';

export function classifyProcesses(rows: Array<{ command: string; args: string }>): { writers: number; automatic: boolean } {
  let writers = 0;
  let automatic = false;
  for (const row of rows) {
    const command = row.command.replaceAll('\\', '/').toLowerCase();
    const args = row.args.replaceAll('\\', '/').toLowerCase();
    const executable = args.split(/\s/u)[0] ?? '';
    const native = `${command} ${executable}`;
    const basenames = [command, executable].map((value) => value.slice(value.lastIndexOf('/') + 1));
    if (native.includes('/contents/helpers/chrome-native-host')) continue;
    const desktop = native.includes('/claude.app/') || basenames.some((basename) => ['claude', 'claude-desktop', 'claude.exe'].includes(basename) || basename.startsWith('claude helper'))
      || native.includes('/anthropicclaude/');
    const cli = native.includes('/claude-code/') || native.includes('/.local/share/claude/versions/')
      || basenames.some((basename) => /^(node|bun)(?:\.exe)?$/u.test(basename)) && args.includes('/@anthropic-ai/claude-code/');
    if (desktop || cli) writers++;
    if (basenames.some((basename) => /^python/u.test(basename)) && /\/(claude-session-sync|claudesync)\/(watch_exit|auto_sync)\.py/u.test(args)) automatic = true;
  }
  return { writers, automatic };
}

interface WriteScope { sessionIds: readonly string[]; label: string }
interface ProcessRow { command: string; args: string; pid?: number }

// Positive session identity can rule out an unrelated CLI invocation. Unknown
// writers, interactive selectors, fork mode, Desktop caches and legacy sync are
// not evidence of disjointness and remain blocked. File-level guards still run.
export function scopedWriterBlockers(rows: ProcessRow[], scope: WriteScope): string[] {
  const blockers: string[] = [];
  for (const row of rows) {
    const result = classifyProcesses([row]);
    if (result.automatic) blockers.push(userMessage('statusAutoSyncRunning'));
    if (!result.writers) continue;
    const args = row.args.replaceAll('\\', '/');
    const native = `${row.command} ${args.split(/\s/u)[0]}`.toLowerCase();
    const desktop = native.includes('/claude.app/') || native.includes('/anthropicclaude/') || native.includes('claude-desktop');
    const identities = [...args.matchAll(/(?:^|\s)(?:--resume|--session-id|-r)(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/giu)].map((match) => match[1]!.toLowerCase());
    const switchesSession = /(?:^|\s)(?:--fork-session|--continue|-c)(?:\s|$)/u.test(args);
    if (!desktop && !switchesSession && identities.length === 1 && !scope.sessionIds.includes(identities[0]!)) continue;
    const reason = identities.some((id) => scope.sessionIds.includes(id)) ? userMessage('statusWriterProcessing') : userMessage('statusWriterUnknownRelation');
    blockers.push(userMessage('statusWriterBlocked', { label: scope.label, pid: row.pid ?? userMessage('statusUnknownPid'), reason }));
  }
  return blockers;
}

function processOutput(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: stderr ?? (isRecord(error) ? error.stderr : '') }));
      else resolve(stdout);
    });
  });
}

export async function processBlockers(scope?: WriteScope): Promise<string[]> {
  const blockers: string[] = [];
  try {
    let rows: ProcessRow[];
    if (process.platform === 'win32') {
      const output = await processOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress']);
      const parsed: unknown = JSON.parse(output);
      rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord).map((row) => ({ pid: Number(row.ProcessId), command: String(row.ExecutablePath || row.Name || ''), args: String(row.CommandLine || '') }));
    } else {
      const output = await processOutput('/bin/ps', ['-axo', 'pid=,comm=,args=']);
      rows = output.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/u.exec(line);
        return match ? [{ pid: Number(match[1]), command: match[2]!, args: match[3]! }] : [];
      });
    }
    const result = classifyProcesses(rows);
    if (scope) blockers.push(...scopedWriterBlockers(rows, scope));
    else {
      if (result.writers) blockers.push(userMessage('statusSaveAndQuit'));
      if (result.automatic) blockers.push(userMessage('statusAutoSyncRunning'));
    }
    if (process.platform === 'darwin') {
      const label = 'local.claude-session-sync.on-exit';
      if (existsSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`))) blockers.push(userMessage('statusAutoSyncLaunchAgent'));
      const service = `gui/${process.getuid?.()}/${label}`;
      try { await processOutput('/bin/launchctl', ['print', service]); blockers.push(userMessage('statusAutoSyncServiceLoaded')); }
      catch (error) {
        const stderr = isRecord(error) ? String(error.stderr ?? '') : '';
        if (!stderr.includes('Could not find service')) throw new Error('无法确认旧自动同步服务已停止。');
      }
    }
  } catch {
    blockers.push(userMessage('statusCannotConfirmStopped'));
  }
  return blockers;
}

export async function assertClaudeStopped(scope?: WriteScope): Promise<void> {
  const blockers = await processBlockers(scope);
  if (blockers.length) throw new Error(messageList(blockers));
}
