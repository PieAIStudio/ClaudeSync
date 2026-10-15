import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildPlan, type Account, type SessionEntry, type SessionRecord } from './index';

const fixtureRoot = resolve(import.meta.dirname, '../../tests/fixtures/basic');
const config = JSON.parse(readFileSync(join(fixtureRoot, 'config.fixture.json'), 'utf8')) as {
  accounts: Account[];
};

function fixtureEntries(): SessionEntry[] {
  const root = join(fixtureRoot, 'session-root');
  return config.accounts.flatMap((account) => {
    const directory = join(root, account.scope);
    return readdirSync(directory)
      .filter((name) => name.startsWith('local_') && name.endsWith('.json'))
      .map((name) => {
        const data = JSON.parse(readFileSync(join(directory, name), 'utf8').replaceAll('__FIXTURE_ROOT__', fixtureRoot)) as SessionRecord;
        if (typeof data.cwd === 'string') data.cwd = data.cwd.replace(fixtureRoot, '__FIXTURE_ROOT__');
        return {
          account,
          path: `${account.scope}/${name}`,
          data,
          eligible: true,
        };
      });
  });
}

it('matches the frozen v1 plan and exact JSON payload on the shared fixture', () => {
  const plan = buildPlan(config.accounts, fixtureEntries(), { verifiedOrganizations: Object.fromEntries(config.accounts.map((account) => account.scope.split('/'))) });
  const oracle = JSON.parse(readFileSync(join(fixtureRoot, 'expected-sync-plan.json'), 'utf8')) as unknown;
  const actual = {
    additions: plan.additions.map((item) => ({
      source: item.source.account.label,
      target: item.target.label,
      targetPath: item.targetPath,
      data: item.data,
    })),
    titleActions: plan.titleActions
      .filter((item) => item.status === 'safe' || item.status === 'normalize' || item.status === 'selected_source')
      .map((item) => ({
        status: item.status,
        source: item.source.account.label,
        target: item.target.account.label,
        targetPath: item.target.path,
        data: item.data,
      })),
  };
  expect(actual).toEqual(oracle);
  expect(plan.additions).toHaveLength(1);
  expect(plan.additions[0]?.target.label).toBe('Account B');
  expect(plan.titleActions).toHaveLength(1);
  expect(plan.titleActions[0]?.status).toBe('safe');
  expect(plan.titleActions[0]?.target.account.label).toBe('Account B');
  expect(plan.titleActions[0]?.data?.title).toBe('Shared manual title');
});
