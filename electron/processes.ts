import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../src/core/storage';

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

export interface WriteScope { sessionIds: readonly string[]; label: string }
interface ProcessRow { command: string; args: string; pid?: number }

// Positive session identity can rule out an unrelated CLI invocation. Unknown
// writers, interactive selectors, fork mode, Desktop caches and legacy sync are
// not evidence of disjointness and remain blocked. File-level guards still run.
export function scopedWriterBlockers(rows: ProcessRow[], scope: WriteScope): string[] {
  const blockers: string[] = [];
  for (const row of rows) {
    const result = classifyProcesses([row]);
    if (result.automatic) blockers.push('旧自动同步程序仍在运行，请先退出，防止同时修改会话。');
    if (!result.writers) continue;
    const args = row.args.replaceAll('\\', '/');
    const native = `${row.command} ${args.split(/\s/u)[0]}`.toLowerCase();
    const desktop = native.includes('/claude.app/') || native.includes('/anthropicclaude/') || native.includes('claude-desktop');
    const identities = [...args.matchAll(/(?:^|\s)(?:--resume|--session-id|-r)(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/giu)].map((match) => match[1]!.toLowerCase());
    const switchesSession = /(?:^|\s)(?:--fork-session|--continue|-c)(?:\s|$)/u.test(args);
    if (!desktop && !switchesSession && identities.length === 1 && !scope.sessionIds.includes(identities[0]!)) continue;
    const reason = identities.some((id) => scope.sessionIds.includes(id)) ? '正在处理这条会话' : '无法确认它与所选文件无关';
    blockers.push(`“${scope.label}”：Claude 进程 ${row.pid ?? '未知'} ${reason}，请先保存并关闭对应窗口，再重新检查。`);
  }
  return blockers;
}

export function processBlockers(scope?: WriteScope): string[] {
  const blockers: string[] = [];
  try {
    let rows: ProcessRow[];
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 20000, windowsHide: true });
      const parsed: unknown = JSON.parse(output);
      rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord).map((row) => ({ pid: Number(row.ProcessId), command: String(row.ExecutablePath || row.Name || ''), args: String(row.CommandLine || '') }));
    } else {
      const output = execFileSync('/bin/ps', ['-axo', 'pid=,comm=,args='], { encoding: 'utf8', timeout: 20000 });
      rows = output.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/u.exec(line);
        return match ? [{ pid: Number(match[1]), command: match[2]!, args: match[3]! }] : [];
      });
    }
    const result = classifyProcesses(rows);
    if (scope) blockers.push(...scopedWriterBlockers(rows, scope));
    else {
      if (result.writers) blockers.push('请保存工作并完全退出 Claude 和 Claude Code，再执行操作。');
      if (result.automatic) blockers.push('旧自动同步程序仍在运行，请先退出，防止同时修改会话。');
    }
    if (process.platform === 'darwin') {
      const label = 'local.claude-session-sync.on-exit';
      if (existsSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`))) blockers.push('旧自动同步自启配置仍存在，请先移除。');
      const service = `gui/${process.getuid?.()}/${label}`;
      try { execFileSync('/bin/launchctl', ['print', service], { encoding: 'utf8', timeout: 20000, stdio: 'pipe' }); blockers.push('旧自动同步服务仍已加载，请先停止。'); }
      catch (error) {
        const stderr = isRecord(error) ? String(error.stderr ?? '') : '';
        if (!stderr.includes('Could not find service')) throw new Error('无法确认旧自动同步服务已停止。');
      }
    }
  } catch {
    blockers.push('无法确认 Claude 已停止，为保护 Code 会话文件，暂时不能写入。');
  }
  return blockers;
}

export function assertClaudeStopped(scope?: WriteScope): void {
  const blockers = processBlockers(scope);
  if (blockers.length) throw new Error(blockers.join('\n'));
}
