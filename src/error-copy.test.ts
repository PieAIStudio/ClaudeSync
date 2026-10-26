import { describe, expect, it } from 'vitest';
import { errorMessages, encodeMessage, messageList } from './error-copy';
import { i18n, locales, type TranslationKey } from './i18n';
import { errorMessage, messageText } from './renderer/errors';

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]!);
}

describe('transported error and status copy', () => {
  it('has five complete translations and matching placeholders for every key', () => {
    for (const [key, values] of Object.entries(errorMessages)) {
      expect(values).toHaveLength(locales.length);
      const expected = placeholders(values[0]!);
      for (const [index, locale] of locales.entries()) {
        expect(placeholders(values[index]!)).toEqual(expected);
        const args = Object.fromEntries(expected.map((name) => [name, name === 'status' || name === 'count' || name === 'accepted' || name === 'applied' || name === 'trashed' || name === 'importedArchived' || name === 'index' ? 3 : name]));
        expect(i18n.translator(locale).t(key as TranslationKey, args)).not.toContain('{');
      }
    }
  });

  it('translates a key in the current locale and preserves unknown text', () => {
    const encoded = encodeMessage('errorWorkspaceRevisionChanged');
    expect(errorMessage(new Error(encoded), 'en')).toBe('The Code session list changed. Refresh before selecting again.');
    expect(errorMessage(new Error(encoded), 'ja')).toBe('Code セッション一覧が変わりました。再読み込みしてから選択してください。');
    expect(errorMessage(new Error('legacy provider failure'), 'en')).toBe('legacy provider failure');
    expect(messageText(messageList([encoded, 'third-party failure']), 'en')).toContain('third-party failure');
  });
});
