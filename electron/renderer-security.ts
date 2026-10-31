import type { Session } from 'electron';

export function denyRendererPermissions(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

// Vite's development preamble and HMR need inline script and a WebSocket.
// This serve-only transform never runs when producing the file:// build.
export function developmentCsp() {
  return {
    name: 'claudesync-development-csp',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      return html.replace(/(http-equiv="Content-Security-Policy" content=")([^"]+)(")/u, (_match, start: string, policy: string, end: string) =>
        start + policy.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace("connect-src 'none'", "connect-src 'self' ws:") + end);
    },
  };
}
