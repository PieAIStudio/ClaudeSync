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
