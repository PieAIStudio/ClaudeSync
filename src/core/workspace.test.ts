import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildWorkspacePlan, loadWorkspace } from './workspace';
import { deterministicBranchIndexId } from './record';

import { SCOPE_A, temporaryFixture } from '../../tests/fixture';
import { sameSnapshot } from './storage';
import { buildCatalog } from './catalog';
import { buildOperationPlan } from './operations';
import { commitFilePlan } from './transaction';

it('loads native task backlogs without counting their tasks as chats', () => {
  const root = temporaryFixture();
  try {
    const configPath = join(root, 'config.json');
    const baseline = loadWorkspace(configPath);
    const backlog = join(root, 'session-root', SCOPE_A, 'backlog');
    mkdirSync(backlog);
    const empty = loadWorkspace(configPath);
    expect(empty.snapshot.directories.get(`${SCOPE_A}/backlog`)).toEqual([]);
    expect(sameSnapshot(baseline.snapshot, empty.snapshot)).toBe(false);
    const raw = Buffer.from('{"version":1,"items":[{"id":"todo_012345abcdef","title":"A task, not a chat"}]}\n');
    writeFileSync(join(backlog, 'tasks.json'), raw);
    const loaded = loadWorkspace(configPath);
    expect(loaded.snapshot.files.get(`${SCOPE_A}/backlog/tasks.json`)).toEqual(raw);
    expect(loaded.snapshot.directories.get(`${SCOPE_A}/backlog`)).toEqual(['tasks.json']);
    expect(buildCatalog(loaded)).toEqual(buildCatalog(baseline));
    expect(buildWorkspacePlan(loaded)).toEqual(buildWorkspacePlan(baseline));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(['linked backlog', 'linked tasks', 'directory tasks', 'unknown backlog file', 'unknown sibling directory'])(
  'still rejects unsafe or unknown structure: %s', (scenario) => {
    const root = temporaryFixture();
    try {
      const scope = join(root, 'session-root', SCOPE_A);
      const backlog = join(scope, 'backlog');
      if (scenario === 'linked backlog') symlinkSync(join(root, 'projects'), backlog, 'dir');
      else if (scenario === 'unknown sibling directory') mkdirSync(join(scope, 'unknown'));
      else {
        mkdirSync(backlog);
        if (scenario === 'linked tasks') symlinkSync(join(root, 'config.json'), join(backlog, 'tasks.json'));
        if (scenario === 'directory tasks') mkdirSync(join(backlog, 'tasks.json'));
        if (scenario === 'unknown backlog file') writeFileSync(join(backlog, 'unknown.json'), '{}');
      }
      expect(() => loadWorkspace(join(root, 'config.json'))).toThrow(/符号链接|普通文件|未知/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  },
);

it('loads the fixture through the filesystem adapter and applies the safe plan', () => {
  const root = temporaryFixture();
  try {
    const workspace = loadWorkspace(join(root, 'config.json'));
    const plan = buildWorkspacePlan(workspace);
    expect(plan.additions).toHaveLength(1);
    expect(plan.titleActions).toHaveLength(1);

    const operation = buildOperationPlan(workspace, { kind: 'sync', sessionIds: workspace.entries.map((entry) => entry.data.cliSessionId!), accountIds: workspace.accounts.map((account) => account.scope.split('/')[0]!) });
    const result = commitFilePlan(workspace, operation, () => undefined);
    expect(result.verified).toBe(true);
    expect(result.filesChanged).toBe(2);
    expect(result.backup).toBeTruthy();
    const after = buildWorkspacePlan(loadWorkspace(join(root, 'config.json')));
    expect(after.additions).toHaveLength(0);
    expect(after.titleActions.filter((action) => action.data)).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('stops before writing when an index changes after the read-only check', () => {
  const root = temporaryFixture();
  try {
    const configPath = join(root, 'config.json');
    const workspace = loadWorkspace(configPath);
    const plan = buildWorkspacePlan(workspace);
    const sourcePath = join(root, 'session-root', plan.additions[0]!.source.path);
    const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
    source.title = 'Changed after check';
    writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
    const operation = buildOperationPlan(workspace, { kind: 'sync', sessionIds: workspace.entries.map((entry) => entry.data.cliSessionId!), accountIds: workspace.accounts.map((account) => account.scope.split('/')[0]!) });
    expect(() => commitFilePlan(workspace, operation, () => undefined)).toThrow('数据发生变化');
    expect(existsSync(join(root, 'session-root', plan.additions[0]!.targetPath))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('blocks resurrecting a session with a deletion marker in another account', () => {
  const root = temporaryFixture();
  try {
    const marker = join(root, 'session-root', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'deleted_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    writeFileSync(marker, '');
    const workspace = loadWorkspace(join(root, 'config.json'));
    const source = workspace.entries.find((entry) => entry.data.cliSessionId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(source?.eligible).toBe(false);
    expect(source?.reason).toContain('删除标记');
    expect(buildWorkspacePlan(workspace).additions).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('excludes an unchecked account as both a session source and a destination', () => {
  const root = temporaryFixture();
  try {
    const workspace = loadWorkspace(join(root, 'config.json'));
    const uncheckedScope = workspace.accounts[1]!.scope;
    expect(buildWorkspacePlan(workspace).titleActions.length).toBeGreaterThan(0);
    workspace.accounts.push({
      label: 'Account C',
      scope: '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });

    const plan = buildWorkspacePlan(workspace, {}, [uncheckedScope]);

    expect(plan.additions.length).toBeGreaterThan(0);
    expect(plan.additions.every((addition) => addition.source.account.scope !== uncheckedScope)).toBe(true);
    expect(plan.additions.every((addition) => addition.target.scope !== uncheckedScope)).toBe(true);
    expect(plan.titleActions).toHaveLength(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps deletion markers from unchecked accounts active as a safety guard', () => {
  const root = temporaryFixture();
  try {
    const uncheckedScope = '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const configPath = join(root, 'config.json');
    const initialWorkspace = loadWorkspace(configPath);
    initialWorkspace.accounts.push({
      label: 'Account C',
      scope: '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(buildWorkspacePlan(initialWorkspace, {}, [uncheckedScope]).additions.some(
      (addition) => addition.source.data.cliSessionId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    )).toBe(true);
    const marker = join(root, 'session-root', uncheckedScope, 'deleted_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    writeFileSync(marker, '');
    const workspace = loadWorkspace(configPath);
    workspace.accounts.push({
      label: 'Account C',
      scope: '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });

    const plan = buildWorkspacePlan(workspace, {}, [uncheckedScope]);

    expect(plan.additions.some((addition) => addition.source.data.cliSessionId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false);
    expect(plan.additions.some((addition) => addition.source.data.cliSessionId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('chooses a deterministic branch file when another session occupies the intended name', () => {
  const root = temporaryFixture();
  try {
    const targetFile = join(root, 'session-root', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'local_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json');
    const occupied = JSON.parse(readFileSync(join(root, 'session-root', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'local_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json'), 'utf8')) as Record<string, unknown>;
    occupied.cliSessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    occupied.isStarred = true;
    writeFileSync(targetFile, `${JSON.stringify(occupied, null, 2)}\n`);
    const workspace = loadWorkspace(join(root, 'config.json'));
    const plan = buildWorkspacePlan(workspace);
    const branch = plan.additions.find((item) => item.source.data.cliSessionId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const expected = `local_${deterministicBranchIndexId('22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')}.json`;
    expect(branch?.targetPath.endsWith(expected)).toBe(true);
    expect(branch?.data.sessionId).toBe(expected.slice(0, -5));
    expect(branch?.data.isStarred).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
