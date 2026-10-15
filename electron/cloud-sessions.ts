import { randomUUID } from 'node:crypto';
import { isRecord, sha256 } from '../src/core/storage';
import type { CloudDeleteResult, CloudSessionView, CloudWorkspaceView } from '../src/shared/contracts';
import { assertSessionCredential, checkDesktopIdentity, readSessionCredential } from './desktop-identity';
import type { AccountIdentity, SessionCredential } from './desktop-identity';
import { rememberIdentities } from './accounts';

const ORIGIN = 'https://api.anthropic.com';
const ID = /^cse_[A-Za-z0-9]{10,80}$/u;
const LIMIT = 100;
interface Row { view: CloudSessionView; fingerprint: string }
interface Snapshot { identity: AccountIdentity & { organizationId: string }; rows: Row[]; at: number }
const snapshots = new Map<string, Snapshot>();

async function currentIdentity(): Promise<Snapshot['identity']> {
  const check = await checkDesktopIdentity();
  if (check.state !== 'verified' || !check.identity?.organizationId) throw new Error('请先登录 Claude，再联网重新检查当前邮箱。');
  rememberIdentities([], check.identity);
  return { ...check.identity, organizationId: check.identity.organizationId };
}

async function request(credential: SessionCredential, path: string, method: 'GET' | 'DELETE'): Promise<Response> {
  assertSessionCredential(credential);
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, { method, headers: {
      Authorization: `Bearer ${credential.token}`, 'anthropic-version': '2023-06-01',
      'anthropic-beta': 'ccr-byoc-2025-07-29', 'anthropic-client-feature': 'ccr',
      'x-organization-uuid': credential.organizationId,
    }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error(method === 'DELETE' ? '删除请求的结果未能确认，已停止，未自动重试。请重新检查。' : '无法读取云端聊天，请检查网络后重新检查。'); }
  assertSessionCredential(credential);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Claude 云端返回 ${response.status}，已停止；没有自动重试或登记新设备。请在 Claude 核对登录与权限。`);
  }
  return response;
}

async function readRows(credential: SessionCredential): Promise<Row[]> {
  const response = await request(credential, `/v1/code/sessions?limit=${LIMIT}&include_trigger_sessions=true`, 'GET');
  const raw = await response.text();
  if (raw.length > 8 * 1024 * 1024) throw new Error('云端列表超过读取上限，暂不能安全处理。');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Claude 云端列表格式改变，已停止处理。'); }
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 5000) throw new Error('Claude 云端列表格式改变，已停止处理。');
  const ids = new Set<string>();
  return value.data.map((item): Row => {
    if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)
      || typeof item.title !== 'string' || item.title.length > 2000 || typeof item.status !== 'string') throw new Error('Claude 云端聊天结构无法识别，已停止处理。');
    ids.add(item.id);
    const status = ['active', 'archived', 'paused', 'failed'].includes(item.status) ? item.status as CloudSessionView['status'] : 'unknown';
    // Current Desktop's Remote Control records were verified live. Unknown formats
    // and linked/template records stay visible but cannot be deleted by this adapter.
    const supported = item.environment_kind === 'bridge' && Array.isArray(item.relations) && item.relations.length === 0
      && Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === 'string' && !/trigger|schedule/iu.test(tag))
      && status !== 'unknown' && item.worker_status === 'idle';
    const running = item.worker_status === 'running';
    const stamp = typeof item.updated_at === 'string' && Number.isFinite(Date.parse(item.updated_at)) ? item.updated_at : undefined;
    const view: CloudSessionView = { id: item.id, title: item.title, status, updatedAt: stamp,
      deletable: supported, ...(supported ? {} : { blockedReason: running ? 'running' : 'unsupported' }) };
    return { view, fingerprint: sha256(JSON.stringify({ view, environment: item.environment_id, tags: item.tags, relations: item.relations, last: item.last_event_at })) };
  });
}

function saveView(identity: Snapshot['identity'], rows: Row[]): CloudWorkspaceView {
  for (const [token, snapshot] of snapshots) if (Date.now() - snapshot.at > 15 * 60 * 1000) snapshots.delete(token);
  if (snapshots.size >= 10) snapshots.delete(snapshots.keys().next().value!);
  const revision = randomUUID();
  snapshots.set(revision, { identity, rows, at: Date.now() });
  return { revision, checkedAt: new Date().toISOString(), accountId: identity.accountId, organizationId: identity.organizationId,
    email: identity.email, sessions: rows.map((row) => row.view), limitReached: rows.length >= LIMIT };
}

export async function cloudSessions(): Promise<CloudWorkspaceView> {
  const identity = await currentIdentity();
  const credential = await readSessionCredential(identity);
  const rows = await readRows(credential);
  assertSessionCredential(credential);
  return saveView(identity, rows);
}

export async function deleteCloudSessions(value: unknown, revision: unknown): Promise<CloudDeleteResult> {
  if (typeof revision !== 'string' || !Array.isArray(value) || value.length < 1 || value.length > LIMIT
    || value.some((id) => typeof id !== 'string' || !ID.test(id))) throw new Error('请勾选云端聊天后再删除。');
  const snapshot = snapshots.get(revision);
  snapshots.delete(revision); // Consume once, including failed or uncertain requests.
  if (!snapshot || Date.now() - snapshot.at > 15 * 60 * 1000) throw new Error('云端列表已过期，请重新检查后选择。');
  const selected = [...new Set(value as string[])];
  if (selected.some((id) => !snapshot.rows.some((row) => row.view.id === id && row.view.deletable))) throw new Error('选择包含不在列表中、正在运行或暂不支持的云端聊天。');
  const identity = await currentIdentity();
  if (identity.accountId !== snapshot.identity.accountId || identity.organizationId !== snapshot.identity.organizationId
    || identity.email !== snapshot.identity.email) throw new Error('Claude 登录账号已改变，尚未删除任何聊天。请重新检查。');
  const credential = await readSessionCredential(identity);
  const fresh = await readRows(credential);
  if (selected.some((id) => fresh.find((row) => row.view.id === id)?.fingerprint !== snapshot.rows.find((row) => row.view.id === id)?.fingerprint)) {
    throw new Error('所选云端聊天的状态或内容已经变化，尚未删除。请重新检查后确认。');
  }
  const accepted: string[] = [];
  const attempted: string[] = [];
  let issue: string | undefined;
  for (const id of selected) {
    try {
      attempted.push(id);
      const response = await request(credential, `/v1/code/sessions/${encodeURIComponent(id)}`, 'DELETE');
      await response.body?.cancel();
      accepted.push(id);
    } catch (error) { issue = error instanceof Error ? error.message : '云端删除中断，未自动重试。'; break; }
  }
  try {
    const after = await readRows(credential);
    const deleted = attempted.filter((id) => !after.some((row) => row.view.id === id)).length;
    if (accepted.some((id) => after.some((row) => row.view.id === id))) issue = '服务器已接受部分删除，但重新读取后仍有记录。请在 Claude 核对；未自动重试。';
    return { deleted, requested: selected.length, ...(issue ? { issue } : {}), workspace: saveView(identity, after) };
  } catch {
    return { deleted: 0, requested: selected.length,
      issue: `${issue ? `${issue}\n` : ''}服务器已接受 ${accepted.length} 条删除请求，但结果暂时无法重新核实。请重新检查；未自动重试。` };
  }
}
