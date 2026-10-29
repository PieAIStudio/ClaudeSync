import type { IconName } from '@pieai/swimmer-ui-kit';
import type { AppLocale, TranslationKey } from './i18n';
import type { GroupVisual } from './visuals';
import type { SessionView } from '../shared/contracts';

export type Theme = 'light' | 'dark';
type Platform = 'mac' | 'windows';
export type Stage = 'home' | 'scan' | 'results' | 'review' | 'progress' | 'complete' | 'cloud' | 'backups' | 'settings';
export type ReviewCategory = 'recent' | 'older' | 'attention' | 'aligned' | 'all';
type ResultCategory = { ids: Set<string>; sessions: SessionView[] };
export type ResultCategories = Record<ReviewCategory, ResultCategory>;

export const languageNames: Record<AppLocale, string> = {
  'zh-CN': '简体中文', en: 'English', ja: '日本語', es: 'Español', 'pt-BR': 'Português',
};

export const categoryLabels: Record<ReviewCategory, TranslationKey> = {
  recent: 'categoryRecent', older: 'categoryOlder', attention: 'categoryAttention', aligned: 'categoryAligned', all: 'categoryAll',
};

export const categoryVisuals: Record<Exclude<ReviewCategory, 'all'>, GroupVisual> = {
  recent: 'recent', older: 'older', attention: 'attention', aligned: 'aligned',
};

export const navItems: Array<{ stage: Stage; label: TranslationKey; icon: IconName }> = [
  { stage: 'home', label: 'overview', icon: 'home' },
  { stage: 'results', label: 'localSessions', icon: 'scroll' },
  { stage: 'cloud', label: 'cloudSessions', icon: 'globe' },
];
