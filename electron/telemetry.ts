import { randomUUID } from 'node:crypto';
import { PostHog } from 'posthog-node';
import type { EventEmitter } from 'node:events';
import { anonymousError } from '../src/shared/telemetry';

const events = ['sessions_checked', 'changes_applied', 'local_sessions_deleted', 'cloud_sessions_checked', 'cloud_sessions_deleted'] as const;
type JobEvent = typeof events[number];
type Client = Pick<PostHog, 'capture' | 'captureException' | 'shutdown' | 'flush'> & { on?: PostHog['on'] };
type Options = { key?: string; host?: string; disabled?: boolean; runtime?: EventEmitter; createClient?: (key: string, options: NonNullable<ConstructorParameters<typeof PostHog>[1]>) => Client };

export function startTelemetry({ key, host, disabled, runtime = process, createClient = (key, options) => new PostHog(key, options) }: Options) {
  // No region guessing, persistent identity, person profiles, flags or raw SDK autocapture.
  const id = randomUUID();
  let client: Client | undefined;
  if (key && ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host ?? '') && !disabled) {
    client = createClient(key, {
      host, disableGeoip: true, enableExceptionAutocapture: false, enableLocalEvaluation: false,
      flushAt: 1, fetchRetryCount: 0,
      before_send: (event) => {
        if (event.event !== '$exception' && !events.includes(event.event as JobEvent)) return null;
        // SDK adds runtime metadata; keep only the explicit anonymous schema.
        const properties: Record<string, unknown> = { app: 'claudesync', $process_person_profile: false, $geoip_disable: true };
        if (event.event === '$exception') {
          // Drop any source context or metadata the SDK's frame processor added.
          const frames = event.properties?.$exception_list?.[0]?.stacktrace?.frames ?? [];
          properties.$exception_list = [{ type: 'Error', value: 'Application error', stacktrace: { type: 'raw',
            frames: frames.slice(0, 20).map((frame: { lineno?: number; colno?: number }) => ({
              filename: 'app', function: 'app', in_app: true,
              ...(Number.isInteger(frame.lineno) ? { lineno: frame.lineno } : {}),
              ...(Number.isInteger(frame.colno) ? { colno: frame.colno } : {}),
            })) } }];
        } else { properties.count = 1; properties.outcome = event.properties?.outcome === 'success' ? 'success' : 'failure'; }
        return { ...event, distinctId: id, properties };
      },
    });
    client.on?.('error', () => {});
  }
  const seen = new WeakSet<object>();
  function error(value: unknown) {
    if (!client) return;
    if (value && typeof value === 'object') { if (seen.has(value)) return; seen.add(value); }
    try { client.captureException(anonymousError(value), id, { app: 'claudesync', $process_person_profile: false }); } catch { /* Telemetry cannot break the job. */ }
  }
  // Monitor preserves Node's normal fatal behavior; Node escalates unhandled rejections here too.
  if (client) runtime.on('uncaughtExceptionMonitor', (value) => { error(value); void client?.flush()?.catch(() => {}); });
  return {
    error,
    event(event: JobEvent, outcome: 'success' | 'failure') {
      if (events.includes(event)) { try { client?.capture({ distinctId: id, event, properties: { app: 'claudesync', count: 1, outcome, $process_person_profile: false } }); } catch { /* Best effort. */ } }
    },
    shutdown: () => client?.shutdown()?.catch(() => {}),
  };
}
