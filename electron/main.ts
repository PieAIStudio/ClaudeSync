import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { configPath, configureFolders, savedRoots } from './accounts';
import { applyOperation, availableBackups, checkWorkspace, cleanupOldCopies, deleteSelected, previewOldCopies, previewOperation, previewRestore } from './service';
import { cloudSessions, deleteCloudSessions } from './cloud-sessions';
import { userError } from '../src/error-copy';

app.setName('ClaudeSync');
if (!app.isPackaged && process.env.CLAUDESYNC_DATA_DIR) {
  const path = resolve(process.env.CLAUDESYNC_DATA_DIR);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  app.setPath('userData', path);
}

function registerIpc(): void {
  function handle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
    ipcMain.handle(`claudesync:${channel}`, (event, ...args: unknown[]) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || event.senderFrame !== event.sender.mainFrame) throw userError('errorInvalidWindow');
      return handler(event, ...args);
    });
  }
  handle('info', () => ({ version: app.getVersion(), configured: existsSync(configPath()),
    suggestedSessionRoot: savedRoots().sessionRoot, suggestedProjectsRoot: savedRoots().projectsRoot }));
  handle('choose-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('configure', (_event, sessionRoot, projectsRoot) => configureFolders(sessionRoot, projectsRoot));
  handle('check', () => checkWorkspace());
  handle('preview', (_event, request, revision) => previewOperation(request, revision));
  handle('apply', (_event, token) => applyOperation(token));
  handle('delete-selected', (_event, request, revision) => deleteSelected(request, revision, (path) => shell.trashItem(path)));
  handle('preview-old-copies', (_event, ids, revision) => previewOldCopies(ids, revision));
  handle('cleanup-old-copies', (_event, token) => cleanupOldCopies(token, (path) => shell.trashItem(path)));
  handle('cloud-sessions', () => cloudSessions());
  handle('delete-cloud-sessions', (_event, ids, revision) => deleteCloudSessions(ids, revision));
  handle('backups', () => availableBackups());
  handle('preview-restore', (_event, id, revision) => previewRestore(id, revision));
  handle('open-backups', async () => {
    const path = join(app.getPath('userData'), 'backups');
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1240, height: 860, minWidth: 740, minHeight: 600, show: false,
    backgroundColor: '#f7f7fb', title: 'ClaudeSync',
    // The frosted sidebar runs under the traffic lights, like native Mac tools.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const development = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    const origin = development && rendererUrl ? new URL(rendererUrl).origin : '';
    const policy = `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'${origin ? ` ${origin} ${origin.replace(/^http/u, 'ws')}` : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && ['github.com', 'code.claude.com'].includes(parsed.hostname)) void shell.openExternal(url);
    } catch { /* Invalid URLs do not leave the app. */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  registerIpc();
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  void app.whenReady().then(() => {
    app.setAppUserModelId('com.pieai.claudesync');
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
