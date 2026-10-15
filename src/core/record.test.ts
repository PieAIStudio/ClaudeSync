import { expect, it } from 'vitest';
import { deterministicBranchIndexId, portableRecord, validateSessionRecord } from './record';

const validRecord = {
  sessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cliSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cwd: '/tmp/project',
  title: 'Fixture title',
  titleSource: 'user',
};

it('rejects changed history schemas and invalid local index IDs', () => {
  expect(() => validateSessionRecord('local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json', {
    ...validRecord, priorCliSessionIds: null,
  })).toThrow('历史正文 ID 格式改变');
  expect(() => validateSessionRecord('local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaZ.json', {
    ...validRecord, sessionId: 'local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaZ',
  })).toThrow('无法识别本地会话结构');
});

it('copies only portable fields and resets permission-specific settings', () => {
  const copied = portableRecord({
    ...validRecord,
    isStarred: true,
    permissionMode: 'bypassPermissions',
    enabledMcpTools: { secret: true },
    remoteMcpServersConfig: [{ secret: true }],
    privateFixtureValue: 'must not travel',
  }, 'local_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(copied.sessionId).toBe('local_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(copied.isStarred).toBe(false);
  expect(copied.permissionMode).toBe('default');
  expect(copied.enabledMcpTools).toEqual({});
  expect(copied.remoteMcpServersConfig).toEqual([]);
  expect(copied).not.toHaveProperty('privateFixtureValue');
});

it('matches the old Python uuid5 naming rule for a branch index', () => {
  expect(deterministicBranchIndexId(
    '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  )).toBe('66c58e57-3b2d-52bd-9a12-1920334cf92b');
});
