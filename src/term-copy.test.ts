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
  it(`${locale}: uses plain session labels and explains the product in context and help`, () => {
    const t = i18n.translator(locale);
    for (const key of ['sessions', 'delete', 'selectedCount', 'untitled'] as const) {
      const label = t.t(key, { count: 4 });
      if (locale === 'zh-CN' || locale === 'en') {
        expect(label).not.toContain('Code');
        expect(label.toLowerCase()).toContain(locale === 'zh-CN' ? '会话' : 'session');
      } else {
        expect(label).toContain('Code');
      }
    }
    expect(t.t('localSub')).toContain('Claude Code');
    expect(t.t('tipCode')).toContain('Code');
    expect(t.t('tipCode')).toContain('Cowork');
    expect(t.t('tipCode')).not.toMatch(/Code Code/u);
  });
}
it.each([
  ['zh-CN', '账号', '本机会话', '云端会话', '本地 Claude Code 会话 · 云端历史单独管理'],
  ['en', 'Accounts', 'On this Mac', 'Cloud', 'Local Claude Code sessions · cloud history is separate'],
] as const)('%s: uses the agreed account-first navigation and scope disclosure', (locale, accounts, local, cloud, scope) => {
  const t = i18n.translator(locale);
  expect(t.t('accounts')).toBe(accounts);
  expect(t.t('localSessions')).toBe(local);
  expect(t.t('cloudSessions')).toBe(cloud);
  expect(t.t('localSub')).toBe(scope);
});
it('does not label old copies as proof of an account move or promise that every local operation is blocked', () => {
  const t = i18n.translator('zh-CN');
  expect(t.t('tipOldOrganization')).not.toContain('账号换过');
  expect(t.t('tipUnverified')).toContain('不往里同步');
  expect(t.t('desktopCount', { count: 4 })).toBe('4 条普通会话');
});
