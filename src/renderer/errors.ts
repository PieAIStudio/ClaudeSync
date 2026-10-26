import { getInitialLocale, i18n, locales, type AppLocale, type TranslationKey } from '../i18n';
import { parseMessage, type MessageParam } from '../error-copy';

function fallbackLocale(): AppLocale {
  try {
    return typeof localStorage === 'undefined' ? 'zh-CN' : getInitialLocale();
  } catch {
    return 'zh-CN';
  }
}

function localizeParam(value: MessageParam, locale: AppLocale): string {
  if (Array.isArray(value)) {
    const separator = locale === 'zh-CN' || locale === 'ja' ? '、' : ', ';
    return value.map((item) => localizeParam(item, locale)).join(separator);
  }
  return typeof value === 'string' ? messageText(value, locale) : String(value);
}

/** Translate a transport message, while preserving unknown/legacy text verbatim. */
export function messageText(value: string, locale: string = fallbackLocale()): string {
  const actualLocale = locales.includes(locale as AppLocale) ? locale as AppLocale : fallbackLocale();
  const parsed = parseMessage(value);
  if (!parsed) return value;
  if (parsed.key === '__multiple__') return parsed.params.messages.map((item) => messageText(item, actualLocale)).join('\n');
  const values = Object.fromEntries(Object.entries(parsed.params).map(([key, item]) => [key, localizeParam(item, actualLocale)]));
  return i18n.translator(actualLocale).t(parsed.key as TranslationKey, values);
}

/** Electron adds the IPC channel to errors; keep only the useful explanation. */
export function errorMessage(reason: unknown, locale: string = fallbackLocale()): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const clean = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '');
  return messageText(clean, locale);
}
