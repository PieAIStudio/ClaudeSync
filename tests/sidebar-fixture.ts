import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addScope, CHAT_A, CHAT_B, ID_A, indexPath, SCOPE_A, temporaryFixture } from './fixture';

export const OLD_SCOPE = `${ID_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
export const syntheticId = (number: number) => `${number.toString(16).padStart(8, '0')}-dddd-4ddd-8ddd-dddddddddddd`;
export const ORDINARY_IDS = [CHAT_A, CHAT_B, syntheticId(2), syntheticId(3)];

// Creates only synthetic files in a new temporary directory. No Desktop,
// credentials, network, or existing application-data path is consulted.
export function sidebarFixture(): string {
  const root = temporaryFixture();
  const source = JSON.parse(readFileSync(indexPath(root, SCOPE_A, CHAT_A), 'utf8'));
  const add = (scope: string, id: string, values: Record<string, unknown> = {}) => {
    writeFileSync(indexPath(root, scope, id), JSON.stringify({
      ...source, sessionId: `local_${id}`, cliSessionId: id, title: 'Synthetic session',
      cwd: join(root, 'project'), isArchived: false, completedTurns: 1, ...values,
    }));
    writeFileSync(join(root, 'projects/project', `${id}.jsonl`), '{"type":"user","message":{"content":"synthetic fixture"}}\n');
  };
  for (const id of ORDINARY_IDS) add(SCOPE_A, id);
  addScope(root, OLD_SCOPE, SCOPE_A);
  for (let n = 100; n < 106; n++) add(OLD_SCOPE, syntheticId(n));
  for (let n = 10; n < 17; n++) add(SCOPE_A, syntheticId(n), { scheduledTaskId: 'synthetic-schedule' });
  add(SCOPE_A, syntheticId(20), { isArchived: true });
  add(SCOPE_A, syntheticId(21));
  // Cover the bare-ID native archive hint, independently of the JSON flag.
  writeFileSync(join(root, 'session-root', SCOPE_A, 'archived-sessions.idx'), JSON.stringify({ v: 1, archived: [syntheticId(21)] }));
  add(SCOPE_A, syntheticId(30));
  writeFileSync(join(root, 'session-root', SCOPE_A, `deleted_${syntheticId(30)}`), '0');
  return root;
}
