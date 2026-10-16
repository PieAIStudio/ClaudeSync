import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeSyncApi } from '../src/shared/contracts';

const api: ClaudeSyncApi = {
  getInfo: () => ipcRenderer.invoke('claudesync:info'),
  chooseDirectory: () => ipcRenderer.invoke('claudesync:choose-directory'),
  configure: (sessionRoot, projectsRoot) => ipcRenderer.invoke('claudesync:configure', sessionRoot, projectsRoot),
  check: () => ipcRenderer.invoke('claudesync:check'),
  preview: (request, revision) => ipcRenderer.invoke('claudesync:preview', request, revision),
  apply: (token) => ipcRenderer.invoke('claudesync:apply', token),
  deleteSelected: (request, revision) => ipcRenderer.invoke('claudesync:delete-selected', request, revision),
  previewOldCopies: (accountIds, revision) => ipcRenderer.invoke('claudesync:preview-old-copies', accountIds, revision),
  cleanupOldCopies: (token) => ipcRenderer.invoke('claudesync:cleanup-old-copies', token),
  cloudSessions: () => ipcRenderer.invoke('claudesync:cloud-sessions'),
  deleteCloudSessions: (ids, revision) => ipcRenderer.invoke('claudesync:delete-cloud-sessions', ids, revision),
  backups: () => ipcRenderer.invoke('claudesync:backups'),
  previewRestore: (id, revision) => ipcRenderer.invoke('claudesync:preview-restore', id, revision),
  openBackups: () => ipcRenderer.invoke('claudesync:open-backups'),
};
contextBridge.exposeInMainWorld('claudeSync', api);
