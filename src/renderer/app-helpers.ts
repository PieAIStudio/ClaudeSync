import type { useTranslation } from './i18n';

type Translation = ReturnType<typeof useTranslation>;

export function homeAccountLabel(index: number, t: Translation): string {
  return index === 0 ? t.t('personalAccount') : index === 1 ? t.t('workAccount') : t.t('accountNumber', { count: index + 1 });
}

export function homeAccountLabels(ids: Iterable<string>, t: Translation): string {
  const labels = [...ids].map((_, index) => homeAccountLabel(index, t));
  return labels.join(t.locale === 'zh-CN' ? '、' : ', ');
}
