import { expect, it } from 'vitest';
import { classifyProcesses } from './processes';

it('recognizes native and npm Claude writers even when ps truncates comm', () => {
  expect(classifyProcesses([
    { command: '/Applications/Cl', args: '/Applications/Claude.app/Contents/MacOS/Claude' },
    { command: 'node', args: '/usr/bin/node /opt/node_modules/@anthropic-ai/claude-code/cli.js' },
    { command: 'claude', args: '/Users/test/.local/share/claude/versions/2.1.0' },
  ]).writers).toBe(3);
});

it('does not block on ClaudeSync, browser native hosts, or shell text mentioning Claude', () => {
  expect(classifyProcesses([
    { command: '/Applications/Cl', args: '/Applications/Claude.app/Contents/Helpers/chrome-native-host chrome-extension://fixture' },
    { command: '/Applications/Cl', args: '/Applications/ClaudeSync.app/Contents/MacOS/ClaudeSync' },
    { command: 'zsh', args: '/bin/zsh -lc cat /Applications/Claude.app/Contents/Info.plist' },
  ])).toEqual({ writers: 0, automatic: false });
});

it('blocks legacy background synchronization and Windows CLI writers', () => {
  expect(classifyProcesses([
    { command: 'python3', args: 'python3 /tmp/claudesync/auto_sync.py' },
    { command: 'node.exe', args: 'node.exe C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js' },
  ])).toEqual({ writers: 1, automatic: true });
});
