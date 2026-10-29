import { useCallback, useEffect, useState } from 'react';
import type { Theme } from './app-types';

const excludedKey = 'claudesync.excluded-account-ids';
const themeKey = 'claudesync.theme';
const compactKey = 'claudesync.compact';
const reducedMotionKey = 'claudesync.reduced-motion';

function readExcluded(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(excludedKey) ?? localStorage.getItem('claudesync.excluded-account-scopes') ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter((item): item is string => typeof item === 'string').map((item) => item.split('/')[0]!))] : [];
  } catch { return []; }
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* localStorage is optional in tests and restricted shells. */ }
  return 'light';
}

function readBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}

export function useAppPreferences() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [compact, setCompact] = useState(() => readBoolean(compactKey));
  const [reducedMotion, setReducedMotion] = useState(() => readBoolean(reducedMotionKey));
  const [excluded, setExcluded] = useState(readExcluded);
  useEffect(() => { try { localStorage.setItem(themeKey, theme); } catch { /* best effort */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(compactKey, String(compact)); } catch { /* best effort */ } }, [compact]);
  useEffect(() => { try { localStorage.setItem(reducedMotionKey, String(reducedMotion)); } catch { /* best effort */ } }, [reducedMotion]);
  const includeAccount = useCallback((id: string, value: boolean) => {
    const next = value ? excluded.filter((item) => item !== id) : [...new Set([...excluded, id])];
    setExcluded(next); localStorage.setItem(excludedKey, JSON.stringify(next));
  }, [excluded]);
  return { theme, setTheme, compact, setCompact, reducedMotion, setReducedMotion, excluded, includeAccount };
}

export function systemPlatform(): 'mac' | 'windows' {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'windows' : 'mac';
}
