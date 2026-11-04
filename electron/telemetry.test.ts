import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startTelemetry } from './telemetry';
import type { PostHogOptions, EventMessage } from 'posthog-node';
import { loadEnv } from 'vite';

vi.mock('posthog-node', () => ({ PostHog: vi.fn() }));

describe('anonymous telemetry', () => {
  it('captures an uncaught error exactly once, preserving only numeric stack locations', () => {
    const runtime = new EventEmitter();
    const client = { capture: vi.fn(), captureException: vi.fn(), shutdown: vi.fn(), flush: vi.fn() };
    const createClient = vi.fn((_key: string, _options: PostHogOptions) => client);
    const tracking = startTelemetry({ key: 'fixture', host: 'https://eu.i.posthog.com', runtime, createClient });
    const error = new Error('alice@example.test /Users/alice/private/chat.json secret prompt');
    error.stack = `${error.message}\n    at privateAccount (/Users/alice/private/chat.json:12:34)`;
    runtime.emit('uncaughtExceptionMonitor', error);
    tracking.error(error); // A boundary observing the same error must not duplicate it.
    expect(client.captureException).toHaveBeenCalledTimes(1);
    const captured = client.captureException.mock.calls[0][0];
    expect(captured.stack).toContain('app:12:34');
    expect(`${captured.message} ${captured.stack}`).not.toMatch(/alice|private|chat\.json|secret|prompt/);
    tracking.event('sessions_checked', 'success');
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ event: 'sessions_checked', properties: { app: 'claudesync', count: 1, outcome: 'success', $process_person_profile: false } }));
    const filter = createClient.mock.calls[0][1].before_send as (event: EventMessage) => EventMessage;
    const filtered = filter({ event: '$exception', distinctId: 'private-account', properties: {
      email: 'alice@example.test', $exception_list: [{ value: 'private', stacktrace: { frames: [
        { filename: '/Users/alice/private', function: 'private', context_line: 'private prompt', lineno: 12, colno: 34 },
      ] } }],
    } });
    expect(JSON.stringify(filtered)).not.toMatch(/alice|private|prompt/);
    expect(filtered.properties?.app).toBe('claudesync');
    expect(client.captureException.mock.calls[0][2].app).toBe('claudesync');
    expect(filtered.properties?.$exception_list[0].stacktrace.frames[0]).toMatchObject({ lineno: 12, colno: 34 });
  });

  it('initialises the actual SDK with a present key without sending anything', async () => {
    const { PostHog } = await vi.importActual<typeof import('posthog-node')>('posthog-node');
    const local = loadEnv('test', process.cwd(), 'POSTHOG_');
    let initialized = false;
    let requests = 0;
    const tracking = startTelemetry({ key: local.POSTHOG_PROJECT_KEY || 'fixture', host: local.POSTHOG_HOST || 'https://eu.i.posthog.com',
      runtime: new EventEmitter(), createClient: (key, options) => {
        const client = new PostHog(key, { ...options, fetch: async () => { requests++; throw new Error('Network forbidden in smoke'); } });
        initialized = true;
        return client;
      } });
    expect(initialized).toBe(true);
    await tracking.shutdown();
    expect(requests).toBe(0);
    if (local.POSTHOG_PROJECT_KEY) console.info('Shared-key-present SDK init smoke passed; no capture/network.');
  });

  it('does not construct a client or install handlers without configuration or when disabled', () => {
    for (const options of [{}, { key: 'fixture', host: 'https://eu.i.posthog.com', disabled: true }]) {
      const runtime = new EventEmitter();
      const createClient = vi.fn();
      const tracking = startTelemetry({ ...options, runtime, createClient });
      tracking.event('sessions_checked', 'success');
      tracking.error(new Error('private'));
      expect(createClient).not.toHaveBeenCalled();
      expect(runtime.listenerCount('uncaughtExceptionMonitor')).toBe(0);
    }
  });
});
