import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { denyRendererPermissions, developmentCsp } from './renderer-security';

it('ships a strict CSP meta before any renderer script for file pages', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/u.exec(html);
  expect(meta).not.toBeNull();
  const policy = meta![1]!;
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
  expect(policy).toContain("form-action 'none'");
  expect(policy).not.toContain('unsafe-eval');
  expect(html.indexOf(meta![0])).toBeLessThan(html.indexOf('<script'));
  expect(developmentCsp().apply).toBe('serve');
});

it('denies every renderer permission request and permission check', () => {
  const request = vi.fn(), check = vi.fn();
  denyRendererPermissions({ setPermissionRequestHandler: request, setPermissionCheckHandler: check });
  const callback = vi.fn();
  for (const permission of ['media', 'geolocation', 'notifications', 'unknown-future-permission']) {
    request.mock.calls[0]![0](null, permission, callback, {});
    expect(callback).toHaveBeenLastCalledWith(false);
    expect(check.mock.calls[0]![0](null, permission, 'file:///', {})).toBe(false);
  }
});
