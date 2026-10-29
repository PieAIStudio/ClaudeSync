import { beforeEach, afterEach, expect, it } from 'vitest';
import { parseMessage } from '../error-copy';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog } from './catalog';
import { buildOperationPlan } from './operations';
import { commitFilePlan, commitFilePlanWithTrash } from './transaction';
import { buildWorkspacePlan } from './workspace';
import { entryGroup } from './visibility';
import { CHAT_A, CHAT_B, ID_A, ID_B, SCOPE_A, SCOPE_B, addScope, indexPath, loadFixtureWorkspace, temporaryFixture } from '../../tests/fixture';

let root: string;
const load = () => loadFixtureWorkspace(join(root, 'config.json'));
const sync = { kind: 'sync' as const, group: 'visible' as const, sessionIds: [CHAT_A], accountIds: [ID_A, ID_B] };
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('lets the user select a surviving deletion-marked copy and explicitly restore it', () => {
  for (const scope of [SCOPE_A, SCOPE_B]) writeFileSync(join(root, 'session-root', scope, `deleted_${CHAT_A}`), 'removed');
  const workspace = load();
  const row = buildCatalog(workspace).sessions.find((session) => session.id === CHAT_A)!;
  expect(row.manageable).toBe(true);
  expect(row.presence.flatMap((presence) => presence.records ?? []).every((record) => record.manageable)).toBe(true);
  commitFilePlan(workspace, buildOperationPlan(workspace, { ...sync, group: 'deleted' }), () => undefined);
  expect(load().entries.filter((entry) => entry.data.cliSessionId === CHAT_A).every((entry) => entry.eligible)).toBe(true);
});
async function deleteFromA() {
  const workspace = load();
  await commitFilePlanWithTrash(workspace, buildOperationPlan(workspace, { kind: 'delete', group: 'visible', sessionIds: [CHAT_A], accountIds: [ID_A] }), () => undefined, async () => undefined);
}

it('restores an explicitly selected B session into A after A deleted it, including native visibility', async () => {
  await deleteFromA();
  const body = readFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`));
  const workspace = load();
  expect(buildWorkspacePlan(workspace).additions.every((addition) => addition.data.cliSessionId !== CHAT_A)).toBe(true);
  const plan = buildOperationPlan(workspace, sync);
  expect(plan.changes.some((change) => change.path === `${SCOPE_A}/local_${CHAT_A}.json`)).toBe(true);
  commitFilePlan(workspace, plan, () => undefined);
  const fresh = load();
  expect(fresh.entries.filter((entry) => entry.data.cliSessionId === CHAT_A).map((entry) => entryGroup(fresh, entry))).toEqual(['visible', 'visible']);
  expect(readFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`))).toEqual(body);
});

it('clears only relevant participating-account markers, including old organization notes, not unrelated or excluded ones', async () => {
  await deleteFromA();
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, oldScope);
  const excluded = '33333333-3333-4333-8333-333333333333/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  addScope(root, excluded);
  for (const scope of [oldScope, excluded]) writeFileSync(join(root, 'session-root', scope, `deleted_${CHAT_A}`), 'earlier deletion');
  const unrelated = join(root, 'session-root', SCOPE_A, `deleted_${CHAT_B}`);
  writeFileSync(unrelated, 'unrelated deletion');
  const workspace = load();
  const plan = buildOperationPlan(workspace, sync);
  commitFilePlan(workspace, plan, () => undefined);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_A))).toBe(true);
  expect(existsSync(join(root, 'session-root', oldScope, `deleted_${CHAT_A}`))).toBe(false);
  expect(readFileSync(unrelated, 'utf8')).toBe('unrelated deletion');
  expect(readFileSync(join(root, 'session-root', excluded, `deleted_${CHAT_A}`), 'utf8')).toBe('earlier deletion');
});

it('does not use marker override to bypass a missing transcript or erase the deletion note alone', async () => {
  await deleteFromA();
  rmSync(join(root, 'projects/project', `${CHAT_A}.jsonl`));
  const workspace = load();
  const plan = buildOperationPlan(workspace, sync);
  expect(plan.changes).toHaveLength(0);
  expect(plan.preview.skipped.some((item) => parseMessage(item.reason)?.key === 'statusTranscriptMissing')).toBe(true);
  expect(existsSync(join(root, 'session-root', SCOPE_A, `deleted_${CHAT_A}`))).toBe(true);
});
