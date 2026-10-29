import { beforeEach, afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildOperationPlan } from './operations';
import { commitFilePlanWithTrash } from './transaction';
import { CHAT_A, CHAT_B, ID_A, SCOPE_A, SCOPE_B, addScope, editIndex, indexPath, loadFixtureWorkspace, temporaryFixture } from '../../tests/fixture';
let root: string;
beforeEach(() => { root = temporaryFixture(); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const load = () => loadFixtureWorkspace(join(root, 'config.json'));
const request = { kind: 'delete' as const, group: 'visible' as const, sessionIds: [CHAT_B], accountIds: [ID_A] };
it('can directly remove an old duplicate without tombstoning its verified current counterpart', async () => {
  const oldScope = ID_A + '/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  addScope(root, oldScope, SCOPE_A);
  const current = readFileSync(indexPath(root, SCOPE_A, CHAT_B));
  const body = readFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`));
  const workspace = load();
  await commitFilePlanWithTrash(workspace, buildOperationPlan(workspace, { ...request, group: 'oldOrganization' }), () => undefined, async () => undefined);
  expect(existsSync(indexPath(root, oldScope, CHAT_B))).toBe(false);
  expect(readFileSync(indexPath(root, SCOPE_A, CHAT_B))).toEqual(current);
  expect(readFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toEqual(body);
  expect(existsSync(join(root, 'session-root', oldScope, `deleted_${CHAT_B}`))).toBe(false);
});
it('does not invalidate a deletion while an unrelated body and index are being updated', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  let first = true;
  await commitFilePlanWithTrash(workspace, plan, () => {
    if (!first) return;
    first = false;
    editIndex(root, SCOPE_A, CHAT_A, { title: 'Independent session' });
    writeFileSync(join(root, 'projects/project', `${CHAT_A}.jsonl`), '{"type":"user","message":{"content":"continued independently"}}\n');
  }, async () => undefined);
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(false);
  expect(JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8')).title).toBe('Independent session');
});
it('still stops if a formerly unrelated session starts claiming the body scheduled for removal', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  editIndex(root, SCOPE_B, CHAT_A, { priorCliSessionIds: [CHAT_B] });
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, async () => undefined)).rejects.toThrow();
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
  expect(existsSync(join(root, 'projects/project', `${CHAT_B}.jsonl`))).toBe(true);
});
it('still stops and names the selected session if its own body is updated', async () => {
  const workspace = load(), plan = buildOperationPlan(workspace, request);
  writeFileSync(join(root, 'projects/project', `${CHAT_B}.jsonl`), '{"type":"user","message":{"content":"selected changed"}}\n');
  await expect(commitFilePlanWithTrash(workspace, plan, () => undefined, async () => undefined)).rejects.toThrow('claudesync-message:errorDependencySessionChanged');
  expect(existsSync(indexPath(root, SCOPE_A, CHAT_B))).toBe(true);
});
