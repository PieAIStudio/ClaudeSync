import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const build = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build;

// Keychain "Always Allow" trusts the packaged ClaudeSync binary. With Electron's
// default fuses, any same-user program could start that trusted binary as plain
// Node (ELECTRON_RUN_AS_NODE, NODE_OPTIONS or --inspect) and read the item silently.
it('stops other local programs from running the packaged binary with their own code', () => {
  expect(build.electronFuses).toMatchObject({
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
  });
});

it('re-signs the unsigned Apple silicon build ad hoc after the fuses change', () => {
  // Flipping a fuse edits the binary; arm64 macOS kills an unsigned edited binary.
  expect(build.mac.identity).toBeNull();
  expect(build.mac.target.arch).toContain('arm64');
  expect(build.electronFuses?.resetAdHocDarwinSignature).toBe(true);
});
