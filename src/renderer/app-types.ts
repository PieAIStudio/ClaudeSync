import type { IconName } from '@pieai/swimmer-ui-kit';
import type { AppLocale, TranslationKey } from './i18n';

export type Theme = 'light' | 'dark';
type Platform = 'mac' | 'windows';
export type Stage = 'home' | 'scan' | 'results' | 'review' | 'progress' | 'complete' | 'cloud' | 'backups' | 'settings';

export const languageNames: Record<AppLocale, string> = {
  'zh-CN': '简体中文', en: 'English', ja: '日本語', es: 'Español', 'pt-BR': 'Português',
};


export const navItems: Array<{ stage: Stage; label: TranslationKey; icon: IconName }> = [
  { stage: 'home', label: 'accounts', icon: 'user' },
  { stage: 'results', label: 'localSessions', icon: 'scroll' },
  { stage: 'cloud', label: 'cloudSessions', icon: 'globe' },
];
