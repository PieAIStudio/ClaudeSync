import { describe, expect, it } from 'vitest';
import { encodeMessage } from '../error-copy';
import { errorMessage } from './errors';

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
