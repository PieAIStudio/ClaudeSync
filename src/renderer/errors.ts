import { getInitialLocale, i18n, locales, type AppLocale, type TranslationKey } from '../i18n';
import { parseMessage, type MessageParam } from '../error-copy';

/** Recorded journal writes only; the final operation result was not verified. */
export interface InterruptedOperation {
  filesChanged: number;
  changedAccountIds: string[];
  /** May overlap changedAccountIds. These accounts are not proven untouched. */
  pendingAccountIds: string[];
}

function transportMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '');
}

/** Preserve the outer structured cause; never classify localized prose. */
export function errorKey(reason: unknown): string | undefined {
  return parseMessage(transportMessage(reason))?.key;
}

/** Read structured journal evidence before localizing the error explanation. */
export function interruptedOperation(reason: unknown): InterruptedOperation | undefined {
  const parsed = parseMessage(transportMessage(reason));
  if (parsed?.key !== 'errorBackupInterrupted') return undefined;
  const { message, path, applied, changedAccountIds, pendingAccountIds } = parsed.params;
  const accountIds = (value: unknown): value is string[] => Array.isArray(value)
    && value.every((id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id));
  if (typeof message !== 'string' || typeof path !== 'string' || !path
    || typeof applied !== 'number' || !Number.isSafeInteger(applied) || applied < 0
    || !accountIds(changedAccountIds) || !accountIds(pendingAccountIds)) return undefined;
  const changed = [...new Set(changedAccountIds)];
  if (changed.length > applied || applied > 0 && !changed.length) return undefined;
  return { filesChanged: applied, changedAccountIds: changed, pendingAccountIds: [...new Set(pendingAccountIds)] };
}

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
  return messageText(transportMessage(reason), locale);
}
