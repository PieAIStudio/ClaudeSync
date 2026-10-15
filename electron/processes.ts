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

export function processBlockers(): string[] {
  const blockers: string[] = [];
  try {
    let rows: Array<{ command: string; args: string }>;
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 20000, windowsHide: true });
      const parsed: unknown = JSON.parse(output);
      rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord).map((row) => ({ command: String(row.ExecutablePath || row.Name || ''), args: String(row.CommandLine || '') }));
    } else {
      const output = execFileSync('/bin/ps', ['-axo', 'pid=,comm=,args='], { encoding: 'utf8', timeout: 20000 });
      rows = output.split('\n').flatMap((line) => {
        const match = /^\s*\d+\s+(\S+)\s*(.*)$/u.exec(line);
        return match ? [{ command: match[1]!, args: match[2]! }] : [];
      });
    }
    const result = classifyProcesses(rows);
    if (result.writers) blockers.push('请保存工作并完全退出 Claude 和 Claude Code，再执行操作。');
    if (result.automatic) blockers.push('旧自动同步程序仍在运行，请先退出，防止同时修改会话。');
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
    blockers.push('无法确认 Claude 已停止，为保护聊天文件，暂时不能写入。');
  }
  return blockers;
}

export function assertClaudeStopped(): void {
  const blockers = processBlockers();
  if (blockers.length) throw new Error(blockers.join('\n'));
}
