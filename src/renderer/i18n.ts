import { createI18nContext } from '@pieai/swimmer-i18n-kit/react';
import { i18n } from '../i18n';

const context = createI18nContext(i18n);

export const I18nProvider = context.Provider;
export const useTranslation = context.useI18n;
export { getInitialLocale, locales } from '../i18n';
export type { AppLocale, TranslationKey } from '../i18n';
