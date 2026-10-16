import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadFixtureWorkspace, CHAT_A } from '../../tests/fixture';
import { sidebarFixture } from '../../tests/sidebar-fixture';
import { buildCatalog } from './catalog';
import { validateSessionRecord } from './record';

it('does not discover or read unrelated sibling stores outside the configured Code roots', () => {
  const root = sidebarFixture();
  try {
    const before = buildCatalog(loadFixtureWorkspace(join(root, 'config.json')));
    // Deliberately synthetic names and invalid contents, not claims about native Cowork/Chat formats.
    for (const sibling of ['unrelated-chat-store', 'unrelated-cowork-store']) {
      const path = join(root, sibling);
      mkdirSync(path);
      writeFileSync(join(path, `local_${CHAT_A}.json`), 'NOT JSON: must never be read');
      writeFileSync(join(path, `${CHAT_A}.jsonl`), 'NOT JSON: must never be read');
    }
    const workspace = loadFixtureWorkspace(join(root, 'config.json'));
    expect(buildCatalog(workspace)).toEqual(before);
    expect(buildCatalog(workspace).accounts[0]?.visible).toBe(4);
    expect([...workspace.snapshot.files.keys()].some((path) => path.includes('unrelated-'))).toBe(false);
    expect([...workspace.transcriptPaths.values()].flat().some((path) => path.includes('unrelated-'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('requires the local Code index contract, not an arbitrary conversation JSON object', () => {
  expect(() => validateSessionRecord(`local_${CHAT_A}.json`, {
    sessionId: `local_${CHAT_A}`, messages: [], title: 'Synthetic non-Code record',
  })).toThrow('无法识别');
});
