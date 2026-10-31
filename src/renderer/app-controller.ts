import { useEffect, useMemo, useState } from 'react';
import { applyDocumentLanguage } from '@pieai/swimmer-i18n-kit/browser';
import type { AppLocale } from './i18n';
import { useTranslation } from './i18n';
import { useWorkspace } from './useWorkspace';
import { useAppPreferences } from './app-preferences';
import { useSessionBrowser } from './app-browser';
import { useOldCleanup } from './app-cleanup';
import { useAppOperations } from './app-operations';
import type { DeleteSelection } from './deletion-selection';
import { accountName } from './components';
import type { ReviewCategory, Stage } from './app-types';

export function useAppController(locale: AppLocale, onLocale: (locale: AppLocale) => void) {
  const t = useTranslation();
  const model = useWorkspace(locale);
  const preferences = useAppPreferences();
  const [stage, setStage] = useState<Stage>('home');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [accountFilter, setAccountFilter] = useState('all');
  const [accountSessionRoot, setAccountSessionRoot] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [deleting, setDeleting] = useState<(DeleteSelection & { revision: string; names: string[] })>();
  const included = useMemo(() => new Set(model.workspace?.accounts.filter((account) => !preferences.excluded.includes(account.id)).map((account) => account.id) ?? []), [model.workspace, preferences.excluded]);
  useEffect(() => applyDocumentLanguage(t.locale, t.direction), [t.locale, t.direction]);
  useEffect(() => { if (model.info) { setAccountSessionRoot(model.info.suggestedSessionRoot); setProjectsRoot(model.info.suggestedProjectsRoot); } }, [model.info]);

  const cleanup = useOldCleanup(model, model.workspace, included, accountFilter, t);
  const busy = model.busy || cloudBusy || cleanup.cleanupBusy;
  const browser = useSessionBrowser(model.workspace, included, busy, accountFilter, setAccountFilter);
  const operations = useAppOperations({ model, workspace: model.workspace, included: browser.included, accountFilter: browser.accountFilter,
    selected: browser.selected, selectionGroup: browser.selectionGroup, setStage, setSelected: browser.setSelected });

  function openReview(category: ReviewCategory, preselect = false) {
    browser.openReview(category, preselect);
    setStage('review');
  }

  function openRename() {
    setNewTitle(browser.scopedGroups[browser.selectionGroup].find((session) => browser.selected.has(session.id))?.title || '');
    setRenameOpen(true);
  }

  function openDeleteConfirmation() {
    if (!model.workspace) return;
    setDeleting({ ...browser.deleteTargets, revision: model.workspace.revision,
      names: browser.deleteTargets.accountIds.map((id) => accountName(model.workspace?.accounts.find((account) => account.id === id), t)) });
  }

  function refreshCloud() {
    setCloudRefresh((value) => value + 1);
  }

  function navigate(next: Stage) {
    if (busy) return;
    if (next === 'cloud' && stage === 'cloud') refreshCloud();
    setStage(next);
  }

  async function saveFolders() {
    await operations.saveFolders(accountSessionRoot, projectsRoot);
  }

  return {
    model, info: model.info, workspace: model.workspace, api: model.api, review: model.review, request: model.request, backups: model.backups,
    error: model.error, deleted: model.deleted, result: model.result, busy, stage, setStage, theme: preferences.theme, setTheme: preferences.setTheme,
    compact: preferences.compact, setCompact: preferences.setCompact, reducedMotion: preferences.reducedMotion, setReducedMotion: preferences.setReducedMotion, includeAccount: preferences.includeAccount,
    locale, onLocale, sessionRoot: accountSessionRoot, setSessionRoot: setAccountSessionRoot, projectsRoot, setProjectsRoot,
    cloudRefresh, refreshCloud, onCloudBusy: setCloudBusy, navigate, openRename, openDeleteConfirmation, ...browser, ...operations, ...cleanup, saveFolders, openReview,
    renameOpen, setRenameOpen, newTitle, setNewTitle, deleting, setDeleting,
  };
}

export type AppController = ReturnType<typeof useAppController>;
