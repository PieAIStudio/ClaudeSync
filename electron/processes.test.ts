import { expect, it } from 'vitest';
import { parseMessage } from '../src/error-copy';

const selectedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = { sessionIds: [selectedId], label: 'Selected old project' };
it('does not block a positively identified unrelated CLI session', () => {
  expect(scopedWriterBlockers([{ pid: 123, command: 'claude', args: `claude --resume ${otherId}` }], scope)).toEqual([]);
});
it('names the selected session and its process when a relevant CLI writer is active', () => {
  const blockers = scopedWriterBlockers([{ pid: 123, command: 'node', args: `/usr/bin/node /tools/@anthropic-ai/claude-code/cli.js --session-id ${selectedId}` }], scope);
  const message = parseMessage(blockers[0]!);
  expect(message?.key).toBe('statusWriterBlocked');
  expect(message?.params).toMatchObject({ label: 'Selected old project', pid: 123 });
  const reason = message && 'reason' in message.params ? message.params.reason : '';
  expect(parseMessage(String(reason))?.key).toBe('statusWriterProcessing');
});
it('still blocks unidentifiable writers, Desktop, interactive selection and legacy automation', () => {
  for (const args of ['claude', 'claude --resume', 'claude --continue', `claude --resume ${otherId} --fork-session`]) {
    expect(scopedWriterBlockers([{ pid: 124, command: 'claude', args }], scope).length).toBeGreaterThan(0);
  }
  expect(scopedWriterBlockers([{ pid: 125, command: '/Applications/Claude.app/Contents/MacOS/Claude', args: 'Claude' }], scope).length).toBeGreaterThan(0);
  expect(scopedWriterBlockers([{ pid: 126, command: 'python3', args: 'python3 /tmp/claudesync/auto_sync.py' }], scope).length).toBeGreaterThan(0);
});
import { classifyProcesses, scopedWriterBlockers } from './processes';

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
