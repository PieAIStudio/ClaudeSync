import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('user-facing errors', () => {
  it('shows the account/session explanation without Electron transport details', () => {
    const explanation = '“只保留所选”不能自动整理远程或定时任务：Awakeclaude。请先在 Claude 中处理。';
    expect(errorMessage(new Error(`Error invoking remote method 'claudesync:preview': Error: ${explanation}`))).toBe(explanation);
  });

  it('preserves ordinary error messages and non-Error failures', () => {
    expect(errorMessage(new Error('聊天列表已经变化，请重新检查。'))).toBe('聊天列表已经变化，请重新检查。');
    expect(errorMessage('请先勾选聊天。')).toBe('请先勾选聊天。');
  });
});
