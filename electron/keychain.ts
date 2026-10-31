import type { Credential } from '@napi-rs/keyring';

// Same buffer-only interface as the former adapter. The maintained N-API addon
// calls Security.framework in this process, not through a shared CLI client.
export async function keychainPassword(): Promise<Buffer> {
  let credentials: Credential[] = [];
  try {
    const { findCredentialsAsync } = await import('@napi-rs/keyring');
    // No command timeout: time spent answering macOS's prompt is human time.
    credentials = await findCredentialsAsync('Claude Safe Storage');
    if (credentials.length !== 1 || !credentials[0]!.password || Buffer.byteLength(credentials[0]!.password, 'utf8') > 4096) throw new Error('unavailable');
    return Buffer.from(credentials[0]!.password, 'utf8');
  } catch {
    // Native errors can contain private attributes. Never forward or log them.
    throw new Error('Desktop identity unavailable');
  } finally {
    // The library returns JS strings, which cannot be securely zeroed. Drop
    // those references immediately; the caller wipes the returned byte buffer.
    for (const credential of credentials) { credential.password = ''; credential.account = ''; }
    credentials.length = 0;
  }
}
