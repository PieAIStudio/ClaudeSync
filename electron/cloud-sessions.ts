import { randomUUID } from 'node:crypto';
import { isRecord, sha256 } from '../src/core/storage';
import type { CloudDeleteResult, CloudSessionView, CloudWorkspaceView } from '../src/shared/contracts';
import { assertSessionCredential, checkDesktopIdentity, readSessionCredential } from './desktop-identity';
import type { AccountIdentity, SessionCredential } from './desktop-identity';
import { rememberIdentities } from './accounts';
import { userError, userMessage } from '../src/error-copy';
import { pruneExpiringMap } from './expiring-map';

const ORIGIN = 'https://api.anthropic.com';
const ID = /^cse_[A-Za-z0-9]{10,80}$/u;
const LIMIT = 100;
interface Row { view: CloudSessionView; fingerprint: string }
interface Snapshot { identity: AccountIdentity & { organizationId: string }; rows: Row[]; at: number }
const snapshots = new Map<string, Snapshot>();

async function currentIdentity(): Promise<Snapshot['identity']> {
  const check = await checkDesktopIdentity();
  if (check.state !== 'verified' || !check.identity?.organizationId) throw userError('errorCloudLoginRequired');
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
  } catch { throw userError(method === 'DELETE' ? 'errorCloudDeleteUnconfirmed' : 'errorCloudReadFailed'); }
  assertSessionCredential(credential);
  if (!response.ok) {
    await response.body?.cancel();
    throw userError('errorCloudHttp', { status: response.status });
  }
  return response;
}

async function readRows(credential: SessionCredential): Promise<Row[]> {
  const response = await request(credential, `/v1/code/sessions?limit=${LIMIT}&include_trigger_sessions=true`, 'GET');
  const raw = await response.text();
  if (raw.length > 8 * 1024 * 1024) throw userError('errorCloudListTooLarge');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw userError('errorCloudListInvalid'); }
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 5000) throw userError('errorCloudListInvalid');
  const ids = new Set<string>();
  return value.data.map((item): Row => {
    if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)
      || typeof item.title !== 'string' || item.title.length > 2000 || typeof item.status !== 'string') throw userError('errorCloudSessionInvalid');
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
  pruneExpiringMap(snapshots, 10);
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
    || value.some((id) => typeof id !== 'string' || !ID.test(id))) throw userError('errorCloudSelectionRequired');
  const snapshot = snapshots.get(revision);
  snapshots.delete(revision); // Consume once, including failed or uncertain requests.
  if (!snapshot || Date.now() - snapshot.at > 15 * 60 * 1000) throw userError('errorCloudListExpired');
  const selected = [...new Set(value as string[])];
  if (selected.some((id) => !snapshot.rows.some((row) => row.view.id === id && row.view.deletable))) throw userError('errorCloudSelectionUnsupported');
  const identity = await currentIdentity();
  if (identity.accountId !== snapshot.identity.accountId || identity.organizationId !== snapshot.identity.organizationId
    || identity.email !== snapshot.identity.email) throw userError('errorCloudIdentityChanged');
  const credential = await readSessionCredential(identity);
  const fresh = await readRows(credential);
  if (selected.some((id) => fresh.find((row) => row.view.id === id)?.fingerprint !== snapshot.rows.find((row) => row.view.id === id)?.fingerprint)) {
    throw userError('errorCloudSelectionChanged');
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
    } catch (error) { issue = error instanceof Error ? error.message : userMessage('statusCloudDeleteInterrupted'); break; }
  }
  try {
    const after = await readRows(credential);
    const deleted = attempted.filter((id) => !after.some((row) => row.view.id === id)).length;
    if (accepted.some((id) => after.some((row) => row.view.id === id))) issue = userMessage('statusCloudPartialAccepted');
    return { deleted, requested: selected.length, ...(issue ? { issue } : {}), workspace: saveView(identity, after) };
  } catch {
    return { deleted: 0, requested: selected.length,
      issue: userMessage('statusCloudReadbackUnconfirmed', { accepted: accepted.length }) };
  }
}
