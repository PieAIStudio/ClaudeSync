import { describe, expect, it } from 'vitest';
import { changedSessionIds, resultOutcome } from './result-copy';
import type { OperationPreview } from '../shared/contracts';

const verified = { filesChanged: 1, verified: true } as const;

describe('changed session IDs', () => {
  it('counts planned sessions once across account copies and excludes aligned or skipped selections', () => {
    const preview: OperationPreview = {
      kind: 'sync', token: 'fixture', accountIds: ['a', 'b', 'c'],
      selected: [
        { id: 'changed', title: 'Changed session' }, { id: 'other', title: 'Another changed session' },
        { id: 'aligned', title: 'Already aligned' }, { id: 'skipped', title: 'Skipped session' },
      ],
      changes: [
        { sessionId: 'changed', title: 'Changed session', accountId: 'b', action: 'add', copies: 2 },
        { sessionId: 'changed', title: 'Changed session', accountId: 'c', action: 'update', copies: 3 },
        { sessionId: 'other', title: 'Another changed session', accountId: 'b', action: 'add', copies: 1 },
        { sessionId: '', title: '', accountId: 'b', action: 'update', copies: 1 },
      ],
      conflicts: [], skipped: [{ id: 'skipped', title: 'Skipped session', reason: 'Fixture skipped session' }], fileCount: 7,
    };
    expect(changedSessionIds(preview)).toEqual(['changed', 'other']);
    expect(changedSessionIds({ ...preview, changes: [] })).toEqual([]);
    expect(changedSessionIds(undefined)).toEqual([]);
  });
});

describe('result outcome', () => {
  it.each([
    ['trash', { ...verified, trashCount: 2 }, 'delete'],
    ['backup', { ...verified, backup: 'backup-id' }, 'archive'],
    ['trashAndBackup', { ...verified, trashCount: 2, backup: 'backup-id' }, 'sync'],
    ['noBackup', verified, 'archive'],
    ['deleteNoTranscript', verified, 'delete'],
  ] as const)('returns %s only for the facts in the result', (expected, result, kind) => {
    expect(resultOutcome(kind, result)).toBe(expected);
  });
});
