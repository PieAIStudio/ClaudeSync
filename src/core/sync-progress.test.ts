import { afterEach, beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildOperationPlan } from './operations';
import { commitFilePlan } from './transaction';
import { CHAT_A, CHAT_B, ID_A, ID_B, SCOPE_A, SCOPE_B, editIndex, indexPath, loadFixtureWorkspace, temporaryFixture } from '../../tests/fixture';

let root: string;
const H1 = '10000000-0000-4000-8000-000000000001';
const H2 = '10000000-0000-4000-8000-000000000002';
const H3 = '10000000-0000-4000-8000-000000000003';
const request = { kind: 'sync' as const, group: 'visible' as const, sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] };
const load = () => loadFixtureWorkspace(join(root, 'config.json'));
beforeEach(() => {
  root = temporaryFixture();
  for (const scope of [SCOPE_A, SCOPE_B]) editIndex(root, scope, CHAT_A, {
    title: 'Shared work', titleSource: 'user', lastAssistantUuid: H1, completedTurns: 1, lastActivityAt: 1000,
  });
  writeFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`), [
    { uuid: H1, parentUuid: null, type: 'assistant', message: { content: 'First turn' } },
    { uuid: H2, parentUuid: H1, type: 'assistant', message: { content: 'Continued on B' } },
    { uuid: H3, parentUuid: H1, type: 'assistant', message: { content: 'Independent branch' } },
  ].map((line) => JSON.stringify(line)).join('\n') + '\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('honors an explicit fork choice and rejects a forged source path', () => {
  editIndex(root, SCOPE_A, CHAT_A, { lastAssistantUuid: H2, completedTurns: 2 });
  editIndex(root, SCOPE_B, CHAT_A, { lastAssistantUuid: H3, completedTurns: 3 });
  const workspace = load();
  expect(() => buildOperationPlan(workspace, { ...request, contentSelections: { [CHAT_A]: '/not-a-source' } })).toThrow('claudesync-message:errorSessionVersionChanged');
  const plan = buildOperationPlan(workspace, { ...request, contentSelections: { [CHAT_A]: `${SCOPE_B}/local_${CHAT_A}.json` } });
  expect(plan.preview.progressConflicts?.[0]?.resolved).toBe(true);
  commitFilePlan(workspace, plan, () => undefined);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8')).lastAssistantUuid).toBe(H3);
});

it('chooses the latest proven source for a missing destination, not the first account scanned', () => {
  // CHAT_B initially exists only in A. Add an older sibling copy in the same scope.
  const otherStem = '20000000-0000-4000-8000-000000000001';
  const older = JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_B), 'utf8'));
  writeFileSync(indexPath(root, SCOPE_A, otherStem), JSON.stringify({ ...older, sessionId: `local_${otherStem}`, lastAssistantUuid: H1, completedTurns: 1 }));
  editIndex(root, SCOPE_A, CHAT_B, { lastAssistantUuid: H2, completedTurns: 2 });
  writeFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`), readFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`)));
  const workspace = load();
  const plan = buildOperationPlan(workspace, { ...request, sessionIds: [CHAT_B] });
  commitFilePlan(workspace, plan, () => undefined);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_B, CHAT_B), 'utf8')).lastAssistantUuid).toBe(H2);
});

it('requires a choice when the transcript gives contradictory parent evidence', () => {
  editIndex(root, SCOPE_B, CHAT_A, { lastAssistantUuid: H2, completedTurns: 2 });
  const body = join(root, 'projects/project', `${CHAT_A}.jsonl`);
  writeFileSync(body, readFileSync(body, 'utf8') + JSON.stringify({ uuid: H2, parentUuid: H3, type: 'assistant' }) + '\n');
  expect(buildOperationPlan(load(), request).preview.progressConflicts?.[0]?.resolved).toBe(false);
});

it('updates an existing A copy from B only when B is a proven continuation, preserving local permissions', () => {
  editIndex(root, SCOPE_A, CHAT_A, { permissionMode: 'plan', isStarred: true, localOnly: 'keep me' });
  editIndex(root, SCOPE_B, CHAT_A, { lastAssistantUuid: H2, completedTurns: 2, lastActivityAt: 2000, permissionMode: 'bypassPermissions' });
  const body = readFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`));
  const workspace = load();
  const plan = buildOperationPlan(workspace, request);
  expect(plan.changes).toHaveLength(1);
  expect(plan.changes[0]).toMatchObject({ path: `${SCOPE_A}/local_${CHAT_A}.json`, action: 'update' });
  expect(plan.preview).toMatchObject({ progressUpdates: [{ sourceAccountId: ID_B, targetAccountId: ID_A, deltaTurns: 1 }] });
  commitFilePlan(workspace, plan, () => undefined);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8'))).toMatchObject({
    lastAssistantUuid: H2, completedTurns: 2, permissionMode: 'plan', isStarred: true, localOnly: 'keep me',
  });
  expect(readFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`))).toEqual(body);
  expect(buildOperationPlan(load(), request).changes).toHaveLength(0);
});

it('does not treat a later timestamp or more turns as proof that a fork may overwrite another copy', () => {
  editIndex(root, SCOPE_A, CHAT_A, { lastAssistantUuid: H2, completedTurns: 2, lastActivityAt: 2000 });
  editIndex(root, SCOPE_B, CHAT_A, { lastAssistantUuid: H3, completedTurns: 30, lastActivityAt: 9000 });
  const workspace = load();
  const plan = buildOperationPlan(workspace, { ...request, sessionIds: [CHAT_A, CHAT_B] });
  expect(plan.preview).toMatchObject({ progressConflicts: [{ id: CHAT_A, options: [{ accountId: ID_A }, { accountId: ID_B }] }] });
  expect(() => commitFilePlan(workspace, plan, () => undefined)).toThrow('claudesync-message:errorProgressConflict');
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_A))).toEqual(workspace.snapshot.files.get(`${SCOPE_A}/local_${CHAT_A}.json`));
});

it('requires an explicit choice when resume heads are absent and progress differs', () => {
  editIndex(root, SCOPE_A, CHAT_A, { lastAssistantUuid: null });
  editIndex(root, SCOPE_B, CHAT_A, { lastAssistantUuid: null, completedTurns: 8, lastActivityAt: 8000 });
  const workspace = load();
  expect(() => commitFilePlan(workspace, buildOperationPlan(workspace, request), () => undefined)).toThrow('claudesync-message:errorProgressConflict');
});
