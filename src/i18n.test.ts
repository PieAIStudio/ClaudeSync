import { describe, expect, it } from 'vitest';
import { i18n, locales } from './i18n';

describe('ClaudeSync language catalogs', () => {
  it.each(locales)('%s has complete, selectable copy', (locale) => {
    expect(i18n.completeness(locale).complete).toBe(true);
    expect(i18n.catalogStatus(locale).selectable).toBe(true);
    expect(i18n.translator(locale).t('selectedCount', { count: 3 })).not.toContain('{count}');
    // The main sync button names how many chats it will move.
    expect(i18n.translator(locale).t('syncCount', { count: 5 })).toContain('5');
    expect(i18n.translator(locale).t('otherRecords', { count: 2 })).toContain('2');
  });
});
