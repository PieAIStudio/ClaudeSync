import { expect, it } from 'vitest';
import { i18n, locales } from './i18n';
import { termTips } from './term-copy';

for (const locale of locales) {
  it.each(Object.entries(termTips))(`${locale}: %s is short, complete and locally translated`, (_term, copy) => {
    const t = i18n.translator(locale);
    const body = t.t(copy.body);
    expect(body).not.toBe(copy.body);
    expect(body.length).toBeLessThanOrEqual(240);
    const sentences = [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(body)];
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.length).toBeLessThanOrEqual(2);
    expect(t.t('helpFor', { term: t.t(copy.label) })).not.toContain('{term}');
  });
  it(`${locale}: names the Code product rather than generic chats`, () => {
    const t = i18n.translator(locale);
    for (const key of ['sessions', 'localSessions', 'cloudSessions', 'delete', 'selectedCount', 'untitled'] as const) {
      expect(t.t(key, { count: 4 })).toContain('Code');
    }
    expect(t.t('tipCode')).toContain('Cowork');
    expect(t.t('tipCode')).not.toMatch(/Code Code/u);
  });
}
it('does not label old copies as proof of an account move or promise that every local operation is blocked', () => {
  const t = i18n.translator('zh-CN');
  expect(t.t('tipOldOrganization')).not.toContain('账号换过');
  expect(t.t('tipUnverified')).toContain('不往里同步');
  expect(t.t('desktopCount', { count: 4 })).toBe('4 条普通会话');
});
