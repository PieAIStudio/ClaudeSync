import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ID_A, ID_B, SCOPE_A } from '../tests/fixture';
import type { AccountIdentity } from './desktop-identity';

const state = vi.hoisted(() => ({ check: vi.fn(), credential: vi.fn(), assert: vi.fn(), fetch: vi.fn(), remember: vi.fn() }));
vi.mock('./desktop-identity', () => ({ checkDesktopIdentity: state.check, readSessionCredential: state.credential, assertSessionCredential: state.assert }));
vi.mock('./accounts', () => ({ rememberIdentities: state.remember }));
import { cloudSessions, deleteCloudSessions } from './cloud-sessions';

const A = 'cse_01AAAAAAAAAAAA1111111111';
const B = 'cse_01BBBBBBBBBBBB2222222222';
const C = 'cse_01CCCCCCCCCCCC3333333333';
const organizationId = SCOPE_A.split('/')[1]!;
const identity: AccountIdentity = { accountId: ID_A, email: 'fixture@example.com', organizationId };
function row(id = A, extra: Record<string, unknown> = {}) {
  return { id, title: 'Wakeup fixture', status: 'archived', worker_status: 'idle', environment_kind: 'bridge',
    environment_id: 'fixture-environment', tags: ['remote-control-sdk'], relations: [], updated_at: '2026-10-14T09:00:00Z',
    config: { private: 'fixture-private-field' }, external_metadata: { private: 'fixture-private-field' }, ...extra };
}
function list(rows = [row()]) { return new Response(JSON.stringify({ data: rows, resume_token: 'fixture-resume-not-exposed' })); }
function mutations() { return state.fetch.mock.calls.filter(([, options]) => options.method === 'DELETE'); }
beforeEach(() => {
  state.check.mockReset().mockResolvedValue({ state: 'verified', identity });
  state.credential.mockReset().mockResolvedValue({ token: 'fixture-token', accountId: ID_A, organizationId });
  state.assert.mockReset();
  state.remember.mockReset();
  state.fetch.mockReset().mockImplementation(async () => list());
  vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it('lists only the verified current account through fixed-origin read-only requests and strips credentials/private payloads from IPC', async () => {
  const view = await cloudSessions();
  expect(view).toMatchObject({ accountId: ID_A, email: identity.email, organizationId, sessions: [{ id: A, title: 'Wakeup fixture', status: 'archived', deletable: true }] });
  expect(JSON.stringify(view)).not.toMatch(/fixture-token|fixture-private-field|fixture-resume/);
  expect(mutations()).toEqual([]);
  expect(state.remember).toHaveBeenCalledWith([], identity);
  expect(state.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/code/sessions?limit=100&include_trigger_sessions=true', expect.objectContaining({
    method: 'GET', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer fixture-token', 'x-organization-uuid': organizationId }),
  }));
});

it('does not save an account or organization when the current profile cannot be verified', async () => {
  state.check.mockResolvedValue({ state: 'unavailable' });
  await expect(cloudSessions()).rejects.toThrow('重新检查');
  expect(state.remember).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it('deletes only confirmed IDs, verifies by independent readback, and consumes the selection once', async () => {
  state.fetch.mockResolvedValueOnce(list([row(), row(B), row(C)]));
  const view = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list([row(), row(B), row(C)]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(list([row(C)]));
  const result = await deleteCloudSessions([A, B], view.revision);
  expect(result).toMatchObject({ deleted: 2, requested: 2, workspace: { sessions: [{ id: C }] } });
  expect(result.issue).toBeUndefined();
  expect(mutations().map(([url]) => url)).toEqual([`https://api.anthropic.com/v1/code/sessions/${A}`, `https://api.anthropic.com/v1/code/sessions/${B}`]);
  await expect(deleteCloudSessions([A], view.revision)).rejects.toThrow('过期');
  expect(mutations()).toHaveLength(2);
});

it.each(['account', 'organization', 'signed out'])('refuses cloud deletion after the %s changes', async (change) => {
  const view = await cloudSessions();
  state.check.mockResolvedValue(change === 'signed out' ? { state: 'unavailable' } : { state: 'verified', identity: { ...identity,
    accountId: change === 'account' ? ID_B : ID_A, organizationId: change === 'organization' ? ID_B : organizationId } });
  await expect(deleteCloudSessions([A], view.revision)).rejects.toThrow();
  expect(mutations()).toEqual([]);
});

it('refuses changed titles/archive state, unknown IDs, running records and task templates before writing', async () => {
  const view = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list([row(A, { title: 'newer title' })]));
  await expect(deleteCloudSessions([A], view.revision)).rejects.toThrow('已经变化');
  const current = await cloudSessions();
  await expect(deleteCloudSessions([B], current.revision)).rejects.toThrow('选择包含');
  state.fetch.mockResolvedValueOnce(list([row(A, { worker_status: 'running' }), row(B, { tags: ['trigger_session'] }), row(C, { relations: [{ type: 'task', id: 'fixture' }] })]));
  const blocked = await cloudSessions();
  expect(blocked.sessions.every((session) => !session.deletable)).toBe(true);
  await expect(deleteCloudSessions([A], blocked.revision)).rejects.toThrow('选择包含');
  expect(mutations()).toEqual([]);
});

it('stops at the first rejected deletion, never enrolls a device or retries, and reports verified partial completion', async () => {
  state.fetch.mockResolvedValueOnce(list([row(), row(B), row(C)]));
  const view = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list([row(), row(B), row(C)]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: 'untrusted_device', private: 'fixture-secret-error' } }), { status: 403 }))
    .mockResolvedValueOnce(list([row(B), row(C)]));
  const result = await deleteCloudSessions([A, B, C], view.revision);
  expect(result).toMatchObject({ deleted: 1, requested: 3 });
  expect(result.issue).toContain('403');
  expect(JSON.stringify(result)).not.toContain('fixture-secret-error');
  expect(mutations()).toHaveLength(2);
  expect(state.fetch.mock.calls.some(([url]) => /enroll|oauth|triggers/u.test(url))).toBe(false);
});

it('does not resend an uncertain DELETE, but can confirm its result with readback', async () => {
  const view = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list()).mockRejectedValueOnce(new Error('fixture-secret-network-error')).mockResolvedValueOnce(list([]));
  const result = await deleteCloudSessions([A], view.revision);
  expect(result.deleted).toBe(1);
  expect(result.issue).toContain('未自动重试');
  expect(result.issue).not.toContain('fixture-secret');
  expect(mutations()).toHaveLength(1);
});

it('does not call an accepted deletion verified if it remains visible or readback fails', async () => {
  const view = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list()).mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(list());
  expect(await deleteCloudSessions([A], view.revision)).toMatchObject({ deleted: 0, requested: 1, issue: expect.stringContaining('仍有记录') });
  const second = await cloudSessions();
  state.fetch.mockResolvedValueOnce(list()).mockResolvedValueOnce(new Response(null, { status: 204 })).mockRejectedValueOnce(new Error('fixture-network'));
  expect(await deleteCloudSessions([A], second.revision)).toMatchObject({ deleted: 0, issue: expect.stringContaining('无法重新核实') });
});
