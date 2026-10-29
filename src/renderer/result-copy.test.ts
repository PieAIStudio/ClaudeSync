import { describe, expect, it } from 'vitest';
import { resultOutcome } from './result-copy';

const verified = { filesChanged: 1, verified: true } as const;

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
