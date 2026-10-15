import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspace, type Workspace } from '../src/core/workspace';

export const SCOPE_A = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SCOPE_B = '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const ID_A = SCOPE_A.split('/')[0]!;
export const ID_B = SCOPE_B.split('/')[0]!;
export const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Test-only verification: fixture creators explicitly choose one organization
// per synthetic account. Production never derives verification from folders.
export function withFixtureOrganizations(workspace: Workspace): Workspace {
  const verifiedOrganizations: Record<string, string> = {};
  for (const { scope } of workspace.accounts) {
    const [id, org] = scope.split('/');
    verifiedOrganizations[id!] ??= org!;
  }
  return { ...workspace, verifiedOrganizations };
}
export function loadFixtureWorkspace(path: string): Workspace { return withFixtureOrganizations(loadWorkspace(path)); }

export function temporaryFixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claudesync-test-')));
  cpSync(resolve(import.meta.dirname, 'fixtures/basic'), root, { recursive: true });
  function replace(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) replace(path);
      else writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__FIXTURE_ROOT__', root));
    }
  }
  replace(root);
  renameSync(join(root, 'config.fixture.json'), join(root, 'config.json'));
  mkdirSync(join(root, 'project'), { recursive: true });
  return root;
}

export function indexPath(root: string, scope: string, chat: string): string { return join(root, 'session-root', scope, `local_${chat}.json`); }
export function editIndex(root: string, scope: string, chat: string, values: Record<string, unknown>): void {
  const path = indexPath(root, scope, chat);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...values }));
}

export function addScope(root: string, scope: string, copyFrom?: string): void {
  const path = join(root, 'session-root', scope);
  if (copyFrom) cpSync(join(root, 'session-root', copyFrom), path, { recursive: true });
  else if (!existsSync(path)) mkdirSync(path, { recursive: true });
  const configPath = join(root, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.accounts.push({ scope, label: `Account ${config.accounts.length + 1}` });
  writeFileSync(configPath, JSON.stringify(config));
}
