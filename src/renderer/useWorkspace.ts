import { useEffect, useRef, useState } from 'react';
import type { AppInfo, ApplyResult, BackupView, DeleteRequest, OperationPreview, OperationRequest, WorkspaceView } from '../shared/contracts';
import { errorKey as getErrorKey, errorMessage, interruptedOperation, type InterruptedOperation } from './errors';
import type { AppLocale } from './i18n';

const api = window.claudeSync;

function useWorkspaceBootstrap(setInfo: (value: AppInfo) => void, setWorkspace: (value: WorkspaceView) => void, onError: (reason: unknown) => void): void {
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
    }).catch((reason: unknown) => { if (active) onError(reason); });
    return () => { active = false; };
  }, []);
}

export function useWorkspace(locale: AppLocale = 'zh-CN') {
  const [info, setInfo] = useState<AppInfo>();
  const [workspace, setWorkspace] = useState<WorkspaceView>();
  const [accountCheckFailed, setAccountCheckFailed] = useState(false);
  const [review, setReview] = useState<OperationPreview>();
  const [request, setRequest] = useState<OperationRequest>();
  const [backups, setBackups] = useState<BackupView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [result, setResult] = useState<ApplyResult>();
  const [interruption, setInterruption] = useState<InterruptedOperation & { explanation: string }>();
  const running = useRef(false);
  useWorkspaceBootstrap(setInfo, setWorkspace, setFailure);

  function setFailure(reason: unknown) {
    setErrorKey(getErrorKey(reason));
    setError(errorMessage(reason, locale));
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true); setError(''); setErrorKey(undefined); setCompleted(false); setDeleted(false); setResult(undefined);
    try { await action(); return true; }
    catch (reason) {
      const evidence = interruptedOperation(reason);
      if (evidence) setInterruption({ ...evidence, explanation: errorMessage(reason, locale) });
      setFailure(reason);
      return false;
    }
    finally { running.current = false; setBusy(false); }
  }

  async function checkWorkspace() {
    try {
      if (!api) throw new Error('Desktop bridge unavailable');
      const view = await api.check();
      setAccountCheckFailed(false);
      return view;
    } catch (reason) {
      setAccountCheckFailed(true);
      throw reason;
    }
  }

  async function refresh() {
    await run(async () => { if (api) { setReview(undefined); setWorkspace(await checkWorkspace()); } });
  }
  async function configure(sessionRoot: string, projectsRoot: string) {
    return await run(async () => {
      if (!api) return;
      await api.configure(sessionRoot, projectsRoot);
      setInfo(await api.getInfo()); setWorkspace(await checkWorkspace()); setReview(undefined);
    });
  }
  async function preview(next: OperationRequest) {
    await run(async () => {
      if (!api || !workspace) return;
      setReview(undefined);
      setRequest(next); setReview(await api.preview(next, workspace.revision));
    });
  }
  async function refreshReview(previous?: OperationPreview): Promise<'preview' | 'list' | undefined> {
    let freshPreview: OperationPreview | undefined;
    const success = await run(async () => {
      if (!api) throw new Error('Desktop bridge unavailable');
      setReview(undefined);
      const fresh = await checkWorkspace();
      setWorkspace(fresh);
      if (previous?.kind === 'restore' && previous.backup) {
        setRequest(undefined);
        freshPreview = await api.previewRestore(previous.backup.id, fresh.revision);
      } else if (previous && request && previous.kind === request.kind) {
        // A new read and a new token are required. Old conflict choices must be reviewed again.
        const next: OperationRequest = { kind: request.kind, group: request.group,
          sessionIds: [...request.sessionIds], accountIds: [...request.accountIds], title: request.title };
        setRequest(next);
        freshPreview = await api.preview(next, fresh.revision);
      }
      setReview(freshPreview);
    });
    return success ? freshPreview ? 'preview' : 'list' : undefined;
  }
  async function apply() {
    if (!api || !review || running.current) return false;
    setInterruption(undefined);
    return await run(async () => {
      // Every token is consumed once; close even if files changed or a guard blocks it.
      const token = review.token;
      setReview(undefined);
      const result = await api.apply(token);
      setWorkspace(result.workspace); setResult(result.result); setCompleted(result.result.verified);
    });
  }
  async function loadBackups() { return await run(async () => { if (api) setBackups(await api.backups()); }); }
  async function deleteSelected(next: DeleteRequest, revision: string) {
    if (!api || running.current) return false;
    setInterruption(undefined);
    return await run(async () => {
      try {
        const result = await api.deleteSelected(next, revision);
        setWorkspace(result.workspace); setResult(result.result); setDeleted(result.result.verified);
      } catch (reason) {
        // A failed direct delete may be partial. Refresh without retrying the mutation.
        try { setWorkspace(await checkWorkspace()); } catch { /* Preserve the deletion error. */ }
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
    catch (reason) { setFailure(reason); return null; }
  }
  return { api, info, workspace, accountCheckFailed, review, request, backups, busy, error, errorKey, completed, deleted, result, interruption, refresh, refreshReview, configure, preview, apply, deleteSelected,
    loadBackups, restore, openBackups, chooseDirectory, closeReview: () => setReview(undefined) };
}
