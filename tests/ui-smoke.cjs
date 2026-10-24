// Test-only Electron acceptance driver. Uses the built app, its real renderer,
// preload, IPC, service and filesystem core; OS processes/Trash are synthetic.
// Run after the build: node tests/ui-smoke.cjs. Never accepts a real data path.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { pathToFileURL } = require('node:url');
const repository = path.resolve(__dirname, '..');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SA = `${A}/${CHAT_A}`, SB = `${B}/${CHAT_B}`;
const OLD = `${A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
const H1 = '10000000-0000-4000-8000-000000000001';
const H2 = '10000000-0000-4000-8000-000000000002';
const skippedEntriesScenario = process.env.CLAUDESYNC_UI_SCENARIO === 'skipped-entries';
const evidenceTask = skippedEntriesScenario ? '2026-10-21-waiting-input' : '2026-10-18-claudesync-fixes';

if (!process.versions.electron) {
  assert(fs.existsSync(path.join(repository, 'out/main/index.js')), 'Build the application first.');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-ui-')));
  const evidence = path.join(repository, '.reports', evidenceTask, path.basename(root));
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  fs.cpSync(path.join(__dirname, 'fixtures/basic'), root, { recursive: true });
  function expand(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) expand(file);
      else fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('__FIXTURE_ROOT__', root));
    }
  }
  expand(root);
  fs.renameSync(path.join(root, 'config.fixture.json'), path.join(root, 'config.json'));
  fs.mkdirSync(path.join(root, 'project'));
  fs.writeFileSync(path.join(root, 'account-identities.json'), JSON.stringify({
    [A]: { email: 'account-a@fixture.invalid', organizationId: CHAT_A },
    [B]: { email: 'account-b@fixture.invalid', organizationId: CHAT_B },
  }));
  if (skippedEntriesScenario) {
    for (const scope of [SA, SB]) fs.mkdirSync(path.join(root, 'session-root', scope, 'waiting-input'));
    fs.writeFileSync(path.join(root, 'session-root', SB, 'waiting-input', `local_${CHAT_B}.json`), Buffer.from([0, 255, 10]));
    const scope = path.join(root, 'session-root', SA);
    fs.mkdirSync(path.join(scope, 'unknown', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(scope, 'unknown', 'nested', 'keep'), 'Opaque nested state');
    fs.symlinkSync(path.join(scope, 'unknown'), path.join(scope, 'unknown-link'), 'dir');
    fs.writeFileSync(path.join(scope, 'unknown.json'), 'NOT JSON');
    if (process.platform !== 'win32') cp.execFileSync('mkfifo', [path.join(scope, 'mystery.pipe')]);
  }
  const env = { ...process.env, HOME: path.join(root, 'home'),
    APPDATA: path.join(root, 'home', 'appdata'), XDG_CONFIG_HOME: path.join(root, 'home', '.config'),
    CLAUDESYNC_DATA_DIR: root, CLAUDESYNC_UI_ROOT: root, CLAUDESYNC_UI_EVIDENCE: evidence };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const result = cp.spawnSync(require('electron'), [__filename], { cwd: repository, env, stdio: 'inherit', timeout: 120000 });
  console.log('SYNTHETIC_UI_EVIDENCE', evidence);
  if (result.error) console.error(result.error.message);
  // Only the exact directory this launcher just created is removed.
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

const { app, shell, session } = require('electron');
const root = process.env.CLAUDESYNC_UI_ROOT;
const evidence = process.env.CLAUDESYNC_UI_EVIDENCE;
assert(root && path.basename(root).startsWith('claudesync-ui-') && fs.realpathSync(root) === root);
assert.equal(process.env.CLAUDESYNC_DATA_DIR, root);
assert.equal(process.env.HOME, path.join(root, 'home'));
assert(evidence && evidence.startsWith(path.join(repository, '.reports', evidenceTask) + path.sep));
for (const name of ['appdata', 'userData']) fs.mkdirSync(path.join(root, 'home', name), { recursive: true });
app.setPath('home', path.join(root, 'home'));
app.setPath('appData', path.join(root, 'home', 'appdata'));
app.setPath('userData', root);
app.commandLine.appendSwitch('lang', 'zh-CN');
let processRows = '', writer, writes = 0, window, successful = false;
const screenshots = [];
const checks = [];
const index = (scope, id) => path.join(root, 'session-root', scope, `local_${id}.json`);
const body = (id) => path.join(root, 'projects/project', `${id}.jsonl`);
const record = (scope, id) => JSON.parse(fs.readFileSync(index(scope, id), 'utf8'));
const edit = (scope, id, values) => fs.writeFileSync(index(scope, id), JSON.stringify({ ...record(scope, id), ...values }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// No real process enumeration, system service lookup, Keychain, browser launch,
// or system Trash can be reached by this acceptance process.
cp.execFileSync = (file) => {
  if (file === '/bin/ps') return processRows;
  if (file === '/bin/launchctl') throw Object.assign(new Error('Synthetic service absent'), { stderr: 'Could not find service' });
  throw new Error(`External command forbidden in isolated UI test: ${file}`);
};
cp.execFile = () => { throw new Error('External command forbidden in isolated UI test'); };
require('node:module').syncBuiltinESMExports();
globalThis.fetch = async () => { throw new Error('Network forbidden in isolated UI test'); };
shell.openExternal = async () => { throw new Error('External links forbidden'); };
shell.openPath = async () => { throw new Error('External paths forbidden'); };
fs.mkdirSync(path.join(root, 'fake-trash'));
shell.trashItem = async (file) => {
  assert(file.startsWith(path.join(root, 'session-root') + path.sep));
  assert.equal(fs.realpathSync(file), file);
  await sleep(35);
  fs.renameSync(file, path.join(root, 'fake-trash', `${fs.readdirSync(path.join(root, 'fake-trash')).length}-${path.basename(file)}`));
};
for (const scope of [SA, SB]) edit(scope, CHAT_A, { title: 'Shared work', titleSource: 'user',
  lastAssistantUuid: scope === SA ? H1 : H2, completedTurns: scope === SA ? 1 : 2,
  lastActivityAt: scope === SA ? 1000 : 2000, permissionMode: scope === SA ? 'plan' : 'bypassPermissions' });
fs.writeFileSync(body(CHAT_A), [
  { uuid: H1, parentUuid: null, type: 'assistant', message: { content: 'First turn' } },
  { uuid: H2, parentUuid: H1, type: 'assistant', message: { content: 'Continued on B' } },
].map(JSON.stringify).join('\n') + '\n');
const initialBody = fs.readFileSync(body(CHAT_A));

async function js(expression) { return window.webContents.executeJavaScript(expression, true); }
async function waitFor(expression, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await js(expression)) return; await sleep(60); }
  throw new Error(`UI did not reach: ${label}\n${await js('document.body.innerText')}`);
}
async function clickButton(text, partial = false) {
  const predicate = partial ? `.includes(${JSON.stringify(text)})` : `===${JSON.stringify(text)}`;
  const find = `[...document.querySelectorAll('button')].find(b => b.textContent.trim()${predicate})`;
  await waitFor(`Boolean((()=>{const b=${find};return b&&!b.disabled})())`, `enabled button ${text}`);
  await js(`(()=>{const b=${find};b.scrollIntoView({block:'center'});b.click()})()`);
  await sleep(80);
}
async function selectSession(id, group = 'session') {
  const domId = group === 'session' ? `session-${id}` : `group-${group}-${id}`;
  await waitFor(`Boolean(document.getElementById(${JSON.stringify(domId)}))`, domId);
  await js(`(()=>{const c=document.getElementById(${JSON.stringify(domId)});if(c.disabled)throw Error('Disabled fixture selection');if(!c.checked)c.click()})()`);
  await sleep(70);
}
async function shot(name) {
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await js(`Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)))`);
  await sleep(250);
  const file = path.join(evidence, name + '.png');
  fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG());
  screenshots.push(name + '.png');
}
async function refresh() {
  const hasTextButton = await js(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重新检查'&&!b.disabled))`);
  if (hasTextButton) {
    await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重新检查'&&!b.disabled);b.click()})()`);
  } else {
    await clickButton('概览');
    await waitFor(`document.body.innerText.includes('换个账号')`, 'refresh home');
    await clickButton('重新检查');
  }
  await waitFor(`document.body.innerText.includes('桌面版里')`, 'refresh results');
  await clickButton('查看');
  await waitFor(`document.body.innerText.includes('挑好聊天')`, 'refresh review');
  await clickButton('全部聊天', true);
  await waitFor(`Boolean(document.getElementById('session-${CHAT_A}'))`, 'refresh complete');
  await sleep(120);
}
async function oldGroup() {
  await js(`(()=>{const d=document.querySelector('details[data-group="oldOrganization"]');if(!d)throw Error('No old group');if(!d.open)d.querySelector('summary').click()})()`);
  await sleep(80);
}
function seedOld(batch) {
  fs.mkdirSync(path.join(root, 'session-root', OLD), { recursive: true });
  const configFile = path.join(root, 'config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.accounts.some((item) => item.scope === OLD)) {
    config.accounts.push({ scope: OLD, label: 'Synthetic old organization' });
    fs.writeFileSync(configFile, JSON.stringify(config));
  }
  const ids = [CHAT_B];
  fs.writeFileSync(index(OLD, CHAT_B), JSON.stringify(record(SA, CHAT_B)));
  for (let n = 1; n <= 5; n++) {
    const id = `${(batch * 100 + n).toString(16).padStart(8, '0')}-dddd-4ddd-8ddd-dddddddddddd`;
    ids.push(id);
    fs.writeFileSync(index(OLD, id), JSON.stringify({ ...record(SA, CHAT_B), sessionId: 'local_' + id,
      cliSessionId: id, title: `Old project ${batch}-${n}`, titleSource: 'user' }));
    fs.writeFileSync(body(id), '{"type":"user","message":{"content":"Synthetic old project"}}\n');
  }
  return ids;
}

function preservedStructure(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink()) return { link: fs.readlinkSync(file) };
  if (info.isDirectory()) return Object.fromEntries(fs.readdirSync(file).sort().map((name) => [name, preservedStructure(path.join(file, name))]));
  return info.isFile() ? { bytes: fs.readFileSync(file).toString('hex') } : { mode: info.mode };
}
async function runSkippedEntries() {
  const paths = ['unknown', 'unknown-link', 'unknown.json', ...(process.platform === 'win32' ? [] : ['mystery.pipe'])]
    .map((name) => path.join(root, 'session-root', SA, name));
  paths.push(...[SA, SB].map((scope) => path.join(root, 'session-root', scope, 'waiting-input')));
  const before = paths.map(preservedStructure);
  await refresh();
  const view = await js('window.claudeSync.check()');
  assert.equal(view.sessions.length, 2);
  assert.equal(view.skippedPaths.length, paths.length - 2);
  assert(view.skippedPaths.every((name) => !name.includes('waiting-input')));
  const text = await js('document.body.innerText');
  assert(text.includes('需要注意'));
  for (const name of view.skippedPaths) assert(text.includes(`${name}：已跳过，未改动`));
  await shot('01-skipped-notice-and-sessions');
  await selectSession(CHAT_B);
  await clickButton('同步所选');
  await waitFor(`Boolean(document.querySelector('dialog[open]'))`, 'known-session sync review');
  await clickButton('确认执行');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('整理完成')`, 'known-session sync complete');
  assert(fs.existsSync(index(SB, CHAT_B)));
  assert.deepEqual(paths.map(preservedStructure), before);
  await clickButton('回到聊天');
  await selectSession(CHAT_B);
  await clickButton('归档所选');
  await waitFor(`Boolean(document.querySelector('dialog[open]'))`, 'known-session archive review');
  await clickButton('确认执行');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('整理完成')`, 'known-session archive complete');
  assert(record(SA, CHAT_B).isArchived && record(SB, CHAT_B).isArchived);
  assert.deepEqual(paths.map(preservedStructure), before);
  await shot('02-sync-archive-preserved-entries');
  checks.push('Known waiting-input is silent; unknown directory/link/file/FIFO has path and skipped-unchanged notice');
  checks.push('Real renderer/preload/IPC sync and archive work; opaque bytes, structures, links and special files unchanged');
  successful = true;
}

async function run() {
  assert.equal(app.getPath('home'), path.join(root, 'home'));
  assert.equal(app.getPath('userData'), root);
  window.setSize(1240, 1000);
  window.webContents.setBackgroundThrottling(false);
  await js('document.fonts.ready.then(() => true)');
  await waitFor(`Boolean([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '重新检查' && !b.disabled))`, 'home check action');
  await clickButton('重新检查');
  await waitFor(`document.body.innerText.includes('桌面版里')`, 'scan results');
  await clickButton('查看');
  await waitFor(`document.body.innerText.includes('挑好聊天')`, 'review loaded');
  await clickButton('已经齐全', true);
  await waitFor(`Boolean(document.getElementById('session-${CHAT_A}'))`, 'review category loaded');
  if (skippedEntriesScenario) return runSkippedEntries();
  // 1: already-present session advances through real UI -> preload -> IPC -> disk.
  await selectSession(CHAT_A);
  await clickButton('同步所选');
  await waitFor(`Boolean(document.querySelector('dialog[open]')) && document.body.innerText.includes('比目标多 1 轮')`, 'source/target progress review');
  await shot('01-progress-preview');
  await clickButton('确认执行');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('整理完成')`, 'progress applied');
  assert.equal(record(SA, CHAT_A).lastAssistantUuid, H2);
  assert.equal(record(SA, CHAT_A).permissionMode, 'plan');
  assert(fs.readFileSync(body(CHAT_A)).equals(initialBody));
  checks.push('Existing A advanced from B; A permission and shared JSONL unchanged');
  await shot('01-progress-complete');
  await clickButton('回到聊天');
  // 2: delete only A, then explicitly restore from B, without a production account.
  await clickButton('account-a@fixture.invalid', true);
  await selectSession(CHAT_A);
  await clickButton('删除选中的 Code 会话');
  await clickButton('确定删除');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('没有创建删除备份')`, 'A deletion complete');
  assert(!fs.existsSync(index(SA, CHAT_A)));
  assert(fs.existsSync(index(SB, CHAT_A)));
  await clickButton('回到聊天');
  await clickButton('account-b@fixture.invalid', true);
  await selectSession(CHAT_A);
  await clickButton('同步所选');
  await waitFor(`Boolean(document.querySelector('dialog[open]')) && document.body.innerText.includes('解除这条会话的删除记录')`, 'restore review');
  assert(!(await js('document.body.innerText')).includes('恢复这个备份'));
  await shot('02-selected-restore-preview');
  await clickButton('确认执行');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('整理完成')`, 'selected restore applied');
  assert.equal(record(SA, CHAT_A).lastAssistantUuid, H2);
  assert(!fs.existsSync(path.join(root, 'session-root', SA, 'deleted_' + CHAT_A)));
  assert(fs.readFileSync(body(CHAT_A)).equals(initialBody));
  checks.push('Deleted A restored from selected B; native note cleared; shared body intact');
  await shot('02-selected-restore-complete');
  await clickButton('回到聊天');
  // 3a/3b: six old copies, while a positively identified unrelated CLI keeps writing.
  await clickButton('account-a@fixture.invalid', true);
  const originalCurrent = fs.readFileSync(index(SA, CHAT_B));
  const originalCurrentBody = fs.readFileSync(body(CHAT_B));
  const oldIds = seedOld(1);
  processRows = `9999 claude claude --resume ${CHAT_A}\n`;
  writer = setInterval(() => {
    writes++;
    edit(SA, CHAT_A, { lastActivityAt: 3000 + writes });
    fs.appendFileSync(body(CHAT_A), JSON.stringify({ type: 'user', message: { content: `Unrelated fixture turn ${writes}` } }) + '\n');
  }, 75);
  await refresh();
  await oldGroup();
  for (const id of oldIds) await selectSession(id, 'oldOrganization');
  await clickButton('删除选中的 Code 会话');
  await shot('03-old-delete-confirm');
  await clickButton('确定删除');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('没有创建删除备份')`, 'old direct deletion');
  assert(oldIds.every((id) => !fs.existsSync(index(OLD, id))));
  assert(fs.readFileSync(index(SA, CHAT_B)).equals(originalCurrent));
  assert(fs.readFileSync(body(CHAT_B)).equals(originalCurrentBody));
  assert(oldIds.slice(1).every((id) => !fs.existsSync(body(id))));
  checks.push('Directly deleted six old copies despite unrelated writes; current duplicate/shared body retained');
  await shot('03-old-delete-complete');
  await clickButton('回到聊天');
  // Independent fresh old IDs exercise the non-destructive cleanup alternative.
  const cleanupIds = seedOld(2);
  await refresh();
  await clickButton('清理旧组织副本');
  await waitFor(`Boolean(document.querySelector('dialog[open]')) && document.body.innerText.includes('确认清理 6 条旧副本')`, 'six-copy cleanup review');
  await shot('03-old-cleanup-preview');
  const beforeWrites = writes;
  await clickButton('确认清理 6 条旧副本');
  await waitFor(`!document.querySelector('dialog[open]') && document.body.innerText.includes('旧副本剩余 0')`, 'old cleanup complete');
  assert.equal(fs.readdirSync(path.join(root, 'fake-trash')).length, 6);
  assert(cleanupIds.every((id) => !fs.existsSync(index(OLD, id))));
  assert(cleanupIds.slice(1).every((id) => record(SA, id).isArchived && fs.existsSync(body(id))));
  assert(fs.readFileSync(index(SA, CHAT_B)).equals(originalCurrent));
  assert(fs.readFileSync(body(CHAT_B)).equals(originalCurrentBody));
  assert(writes > beforeWrites);
  checks.push('Cleanup trashed six synthetic indexes, returned five unique sessions archived, preserved main/shared data during unrelated writes');
  await shot('03-old-cleanup-complete');
  successful = true;
}

app.on('browser-window-created', (_event, created) => {
  window = created;
  created.webContents.once('did-finish-load', async () => {
    try { await run(); }
    catch (error) {
      console.error(error.stack);
      fs.writeFileSync(path.join(evidence, 'failure.txt'), String(error.stack));
      await shot('failure').catch(() => undefined);
    } finally {
      clearInterval(writer);
      fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ success: successful, checks, screenshots,
        syntheticUnrelatedWrites: writes, adapters: 'Synthetic process list and fixture-only Trash; network/external commands blocked',
        actualRendererPreloadIpcAndCore: true, ownerDataUsed: false }, null, 2));
      console.log('UI_SMOKE_RESULT', JSON.stringify({ success: successful, paths: checks.length, screenshots: screenshots.length, writes }));
      app.exit(successful ? 0 : 1);
    }
  });
});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') });
}));
import(pathToFileURL(path.join(repository, 'out/main/index.js')).href).catch((error) => { console.error(error); app.exit(1); });
