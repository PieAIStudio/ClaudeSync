import { useState } from 'react';
import { rememberLocale } from '@pieai/swimmer-i18n-kit/browser';
import { I18nProvider, getInitialLocale } from './i18n';
import type { AppLocale } from './i18n';
import { AppContent } from './AppContent';

export function App() {
  const [locale, setLocale] = useState<AppLocale>(getInitialLocale);
  return <I18nProvider locale={locale}><AppContent locale={locale} onLocale={(value) => { setLocale(value); void rememberLocale({ get: () => localStorage.getItem('claudesync.locale') ?? undefined, set: (next) => localStorage.setItem('claudesync.locale', next) }, value); }} /></I18nProvider>;
}
