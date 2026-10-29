import { describe, expect, it } from 'vitest';
import { i18n, locales, messages } from './i18n';

describe('ClaudeSync language catalogs', () => {
  it.each(locales)('%s has complete, selectable copy', (locale) => {
    expect(i18n.completeness(locale).complete).toBe(true);
    expect(i18n.catalogStatus(locale).selectable).toBe(true);
    expect(i18n.translator(locale).t('selectedCount', { count: 3 })).not.toContain('{count}');
    // The main sync button names how many chats it will move.
    expect(i18n.translator(locale).t('syncCount', { count: 5 })).toContain('5');
    expect(i18n.translator(locale).t('otherRecords', { count: 2 })).toContain('2');
  });

  it('uses the plain older-chat label in both supported blind-test languages', () => {
    expect(i18n.translator('zh-CN').t('categoryOlder')).toBe('可以清理的旧聊天');
    expect(i18n.translator('en').t('categoryOlder')).toBe('Older chats you can clean up');
  });

  it('names older-chat cleanup as archiving while keeping sync and Trash copy explicit', () => {
    const zh = i18n.translator('zh-CN');
    const en = i18n.translator('en');
    expect(zh.t('cleanupReady')).toBe('可归档');
    expect(en.t('cleanupReady')).toBe('Ready to archive');
    expect(zh.t('archiveCount', { count: 1 })).toBe('归档 1 条');
    expect(en.t('archiveCount', { count: 1 })).toBe('Archive 1');
    expect(zh.t('syncCount', { count: 1 })).toBe('同步 1 条');
    expect(en.t('syncCount', { count: 1 })).toBe('Sync 1');
    expect(zh.t('archiveUndoHelp')).toContain('已归档');
    expect(zh.t('archiveUndoHelp')).toContain('取消归档');
    expect(en.t('archiveUndoHelp')).toContain('Archived');
    expect(en.t('archiveUndoHelp')).toContain('Unarchive selected');
    expect(zh.t('deleteNoRecovery')).toContain('废纸篓');
    expect(en.t('deleteNoRecovery')).toContain('Trash');
  });

  it('keeps English copy free of Chinese characters and full-width colons', () => {
    for (const [key, values] of Object.entries(messages)) {
      expect(values[1], key).not.toMatch(/[\u3400-\u9fff：]/u);
    }
    const en = i18n.translator('en');
    expect(en.t('deleteConfirmTitleOne')).toBe('Delete this 1 Code session?');
    expect(en.t('resultTrashOne')).toContain('1 transcript file');
    expect(en.t('resultTrashOne')).not.toContain('files');
  });
});
