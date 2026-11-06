import { describe, expect, it } from 'vitest';
import { encodeMessage } from '../error-copy';
import { errorKey, errorMessage, interruptedOperation } from './errors';

describe('user-facing errors', () => {
  it('translates a transported key without Electron transport details', () => {
    const encoded = encodeMessage('errorKeepUnsupported', { title: 'Awakeclaude' });
    expect(errorMessage(new Error(`Error invoking remote method 'claudesync:preview': Error: ${encoded}`), 'en')).toBe('“Keep only selected” cannot organize remote or scheduled sessions automatically: Awakeclaude. Manage it in Claude first.');
  });

  it('preserves ordinary error messages and non-Error failures', () => {
    expect(errorMessage(new Error('聊天列表已经变化，请重新检查。'), 'en')).toBe('聊天列表已经变化，请重新检查。');
    expect(errorMessage('请先勾选聊天。', 'en')).toBe('请先勾选聊天。');
  });
});

describe('structured error keys', () => {
  it.each(['errorWorkspaceChanged', 'errorOrganizationChanged', 'errorPreviewExpired'] as const)('preserves the genuine outer key %s across Electron transport', (key) => {
    const encoded = encodeMessage(key);
    expect(errorKey(encoded)).toBe(key);
    expect(errorKey(new Error(encoded))).toBe(key);
    expect(errorKey(new Error(`Error invoking remote method 'claudesync:apply': Error: ${encoded}`))).toBe(key);
    expect(errorKey(`Error invoking remote method 'claudesync:apply': ${encoded}`)).toBe(key);
  });

  it.each([
    new Error('Sessions changed before syncing'),
    errorMessage(encodeMessage('errorWorkspaceChanged'), 'en'),
    errorMessage(encodeMessage('errorWorkspaceChanged'), 'zh-CN'),
    'claudesync-message:unknownError:{}', 'claudesync-message:errorWorkspaceChanged:{',
    'claudesync-message:errorWorkspaceChanged:[]', null, undefined,
  ])('does not infer a key from unknown, malformed or localized text %#', (reason) => {
    expect(errorKey(reason)).toBeUndefined();
  });

  it('keeps an interrupted operation distinct from its nested stale-session cause', () => {
    const encoded = encodeMessage('errorBackupInterrupted', {
      message: encodeMessage('errorWorkspaceChanged'), path: '/fixture/backups/interrupted',
    });
    expect(errorKey(new Error(`Error invoking remote method 'claudesync:apply': Error: ${encoded}`))).toBe('errorBackupInterrupted');
  });
});

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const evidence = {
  message: 'Synthetic writer interruption', path: '/fixture/backups/interrupted',
  applied: 2, changedAccountIds: [ID_A], pendingAccountIds: [ID_A, ID_B],
};

describe('interrupted operation evidence', () => {
  it('reads recorded writes before localization and preserves account overlap', () => {
    const encoded = encodeMessage('errorBackupInterrupted', evidence);
    const reason = new Error("Error invoking remote method 'claudesync:apply': Error: " + encoded);
    const expected = { filesChanged: 2, changedAccountIds: [ID_A], pendingAccountIds: [ID_A, ID_B] };
    expect(interruptedOperation(reason)).toEqual(expected);
    expect(interruptedOperation(encoded)).toEqual(expected);
    expect(errorMessage(reason, 'en')).toContain('Synthetic writer interruption');
    expect(errorMessage(reason, 'en')).not.toContain('claudesync:');
  });

  it('keeps zero-write and unverified final-check interruptions distinct', () => {
    expect(interruptedOperation(encodeMessage('errorBackupInterrupted', {
      ...evidence, applied: 0, changedAccountIds: [],
    }))).toEqual({ filesChanged: 0, changedAccountIds: [], pendingAccountIds: [ID_A, ID_B] });
    expect(interruptedOperation(encodeMessage('errorBackupInterrupted', {
      ...evidence, changedAccountIds: [ID_A, ID_B], pendingAccountIds: [],
    }))).toEqual({ filesChanged: 2, changedAccountIds: [ID_A, ID_B], pendingAccountIds: [] });
  });

  it('deduplicates each account list without removing overlap between lists', () => {
    expect(interruptedOperation(encodeMessage('errorBackupInterrupted', {
      ...evidence, changedAccountIds: [ID_A, ID_A], pendingAccountIds: [ID_A, ID_B, ID_A],
    }))).toEqual({ filesChanged: 2, changedAccountIds: [ID_A], pendingAccountIds: [ID_A, ID_B] });
  });

  it.each([
    { applied: -1 }, { applied: 1.5 }, { applied: '2' }, { applied: Number.MAX_SAFE_INTEGER + 1 },
    { changedAccountIds: undefined }, { pendingAccountIds: ID_B }, { pendingAccountIds: null },
    { changedAccountIds: ['not-an-account'] }, { pendingAccountIds: ['f'.repeat(36)] },
    { changedAccountIds: [{ id: ID_A }] }, { message: {} }, { path: undefined },
    { applied: 0 }, { applied: 1, changedAccountIds: [ID_A, ID_B] }, { changedAccountIds: [] },
  ])('does not expose malformed or contradictory journal evidence %#', (params) => {
    const encoded = 'claudesync-message:errorBackupInterrupted:' + JSON.stringify({ ...evidence, ...params });
    expect(interruptedOperation(encoded)).toBeUndefined();
  });

  it('leaves unrelated, malformed and legacy errors without inferred evidence', () => {
    expect(interruptedOperation(new Error('Ordinary failure'))).toBeUndefined();
    expect(interruptedOperation(encodeMessage('errorDeleteInterrupted', evidence))).toBeUndefined();
    expect(interruptedOperation(encodeMessage('errorBackupInterrupted', { message: evidence.message, path: evidence.path }))).toBeUndefined();
    expect(interruptedOperation('claudesync-message:errorBackupInterrupted:{')).toBeUndefined();
    expect(interruptedOperation(null)).toBeUndefined();
  });
});
