import { useEffect, useRef, useState } from 'react';
import type { AppInfo, BackupView, DeleteRequest, OperationPreview, OperationRequest, WorkspaceView } from '../shared/contracts';
import { errorMessage } from './errors';
import type { AppLocale } from './i18n';

const api = window.claudeSync;

function useWorkspaceBootstrap(locale: AppLocale, setInfo: (value: AppInfo) => void, setWorkspace: (value: WorkspaceView) => void, setError: (value: string) => void): void {
  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.getInfo().then(async (value) => {
      if (!active) return;
      setInfo(value);
      if (value.configured) {
        const view = await api.check();
        if (active) setWorkspace(view);
      }
    }).catch((reason: unknown) => { if (active) setError(errorMessage(reason, locale)); });
    return () => { active = false; };
  }, []);
}

export function useWorkspace(locale: AppLocale = 'zh-CN') {
  const [info, setInfo] = useState<AppInfo>();
  const [workspace, setWorkspace] = useState<WorkspaceView>();
  const [review, setReview] = useState<OperationPreview>();
  const [request, setRequest] = useState<OperationRequest>();
  const [backups, setBackups] = useState<BackupView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const running = useRef(false);
  useWorkspaceBootstrap(locale, setInfo, setWorkspace, setError);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true); setError(''); setCompleted(false); setDeleted(false);
    try { await action(); return true; }
    catch (reason) { setError(errorMessage(reason, locale)); return false; }
    finally { running.current = false; setBusy(false); }
  }

  async function refresh() {
    await run(async () => { if (api) { setReview(undefined); setWorkspace(await api.check()); } });
  }
  async function configure(sessionRoot: string, projectsRoot: string) {
    return await run(async () => {
      if (!api) return;
      await api.configure(sessionRoot, projectsRoot);
      setInfo(await api.getInfo()); setWorkspace(await api.check()); setReview(undefined);
    });
  }
  async function preview(next: OperationRequest) {
    await run(async () => {
      if (!api || !workspace) return;
      setReview(undefined);
      setRequest(next); setReview(await api.preview(next, workspace.revision));
    });
  }
  async function apply() {
    await run(async () => {
      if (!api || !review) return;
      // Every token is consumed once; close even if files changed or a guard blocks it.
      const token = review.token;
      setReview(undefined);
      const result = await api.apply(token);
      setWorkspace(result.workspace); setCompleted(result.result.verified);
    });
  }
  async function loadBackups() { return await run(async () => { if (api) setBackups(await api.backups()); }); }
  async function deleteSelected(next: DeleteRequest, revision: string) {
    return await run(async () => {
      if (!api) return;
      try {
        const result = await api.deleteSelected(next, revision);
        setWorkspace(result.workspace); setDeleted(result.result.verified);
      } catch (reason) {
        // A failed direct delete may be partial. Refresh without retrying the mutation.
        try { setWorkspace(await api.check()); } catch { /* Preserve the deletion error. */ }
        throw reason;
      }
    });
  }
  async function restore(id: string) {
    await run(async () => { if (api && workspace) { setRequest(undefined); setReview(await api.previewRestore(id, workspace.revision)); } });
  }
  async function openBackups() { await run(async () => { await api?.openBackups(); }); }
  async function chooseDirectory() {
    if (!api || running.current) return null;
    try { return await api.chooseDirectory(); }
    catch (reason) { setError(errorMessage(reason, locale)); return null; }
  }
  return { api, info, workspace, review, request, backups, busy, error, completed, deleted, refresh, configure, preview, apply, deleteSelected,
    loadBackups, restore, openBackups, chooseDirectory, closeReview: () => setReview(undefined) };
}
