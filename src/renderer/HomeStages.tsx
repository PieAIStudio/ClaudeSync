import { Button, Icon } from '@pieai/swimmer-ui-kit';
import { StageFrame } from './StageFrame';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { accountName, SkippedEntriesNotice } from './components';
import { PageArt, RelayArt } from './visuals';
import { changedSessionIds } from './result-copy';

export function HomeStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const workspace = controller.workspace;
  const summary = controller.accountSummary;
  const comparable = controller.included.size >= 2 && controller.targetsVerified;
  const checking = (!controller.info && !controller.error) || controller.busy || Boolean(controller.info?.configured && !workspace && !controller.error);
  const hasAccounts = Boolean(workspace?.accounts.length);
  const verified = workspace?.identityState === 'verified' && !controller.model.accountCheckFailed;
  const state = checking ? 'checking' : controller.info && !controller.info.configured ? 'welcome'
    : workspace && !hasAccounts ? 'empty' : !verified ? 'unverified' : !comparable ? 'compare'
    : summary.missingSessionIds.size ? 'missing' : 'aligned';
  const title = state === 'missing'
    ? t.t(summary.missingSessionIds.size === 1 ? 'missingSessionOne' : 'missingSessions', { count: summary.missingSessionIds.size })
    : t.t(state === 'checking' ? 'checkingAccounts' : state === 'welcome' ? 'accountsWelcomeTitle'
      : state === 'empty' ? 'accountsEmptyTitle' : state === 'unverified' ? 'accountCheckFailedTitle'
      : state === 'compare' ? 'accountsCompareTitle' : 'accountsAlignedTitle');
  const description = state === 'missing'
    ? t.t(summary.missingCopies === 1 ? 'missingCopyOne' : 'missingCopies', { count: summary.missingCopies })
    : t.t(state === 'checking' ? 'checkAccountSafety' : state === 'welcome' ? 'accountsWelcomeBody'
      : state === 'empty' ? 'accountsEmptyBody' : state === 'unverified' ? (hasAccounts ? 'accountCheckNext' : 'accountCheckRetry')
      : state === 'compare' ? 'chooseCompareAccounts' : 'accountVersions');
  const checkAction = <Button variant={state === 'unverified' ? 'primary' : 'ghost'} static disabled={checking}
    onClick={() => controller.info?.configured ? void controller.startCheck() : controller.navigate('settings')}><Icon icon="redo" />{t.t('checkAccounts')}</Button>;
  return <StageFrame className="stage-surface stage-surface--accounts" data-account-state={state}
    title={title} description={description} header={checking ? <div className="account-state-art"><RelayArt state="scanning" compact /></div> : state === 'empty' || state === 'welcome' ? undefined : <PageArt kind="hero" />}
    primaryAction={<div className="account-heading-actions">
      {state === 'missing' && <Button variant="primary" static className="missing-filter" onClick={() => controller.openSessions('all', true)}>{t.t('findMissing')}<Icon icon="arrow-right" /></Button>}
      {(state === 'aligned' || state === 'compare') && <Button variant="primary" static onClick={() => controller.openSessions()}>{t.t('openSessions')}<Icon icon="arrow-right" /></Button>}
      {(state === 'empty' || state === 'welcome') && <Button variant="primary" static onClick={() => controller.navigate('settings')}>{t.t('settings')}<Icon icon="arrow-right" /></Button>}
      {state !== 'welcome' && checkAction}
      {state === 'unverified' && hasAccounts && <Button variant="ghost" static onClick={() => controller.openSessions()}>{t.t('openSessions')}</Button>}
    </div>}>
    {checking && <div className="account-check-progress" role="status"><span className="account-spinner" aria-hidden="true" /><span>{t.t('checkingAccounts')}</span></div>}
    {checking && !hasAccounts && <div className="account-grid account-placeholders" aria-hidden="true">{[0, 1, 2].map((item) => <div className="account-placeholder" key={item}><span /><i /><i /><b /></div>)}</div>}
    {(state === 'empty' || state === 'welcome') && <div className="account-empty"><RelayArt state="ready" compact /><p>{t.t('accountsEmptyHint')}</p></div>}
    {(!workspace || checking) && <div className="account-welcome"><p>{t.t('accountsKeychain')}</p><small>{t.t('noLoginSwitch')}</small></div>}
    {workspace && <>
      {!verified && hasAccounts && (workspace.identityState === 'changed' || workspace.identityState === 'unsupported') && <p className="account-identity-note" role="status"><Icon icon="alert" />{t.t(workspace.identityState === 'changed' ? 'identityChanged' : 'identityUnsupported')}</p>}
      {hasAccounts && <p className="account-count-rule"><span>{t.t('accountCountRule')}</span>{state !== 'aligned' && <span>{t.t('accountVersions')}</span>}</p>}
      <div className="account-grid">{workspace.accounts.map((account) => {
        const counts = summary.accounts.find((item) => item.accountId === account.id);
        const count = account.organizationVerified ? account.visible : null;
        const missing = counts?.missingCount ?? null;
        const name = accountName(account, t);
        const status = !verified ? 'accountUnchecked' : account.current ? 'current' : 'accountNotCurrent';
        return <article className="account-card" key={account.id} data-account-id={account.id} data-current={status === 'current'}>
          <div className="account-card-top"><span className="account-avatar" aria-hidden="true">{account.email ? account.email.slice(0, 1).toUpperCase() : <Icon icon="user" />}</span>
            {verified && <span className="account-status" data-status={status}>{status === 'current' && <span className="sign-in-dot" aria-hidden="true" />}{t.t(status)}</span>}</div>
          <h2 title={name}>{name}</h2>
          <div className="account-count"><strong>{count ?? '—'}</strong><span>{t.t(count === null ? 'accountUnavailable' : count === 1 ? 'localCountLabelOne' : 'localCountLabel')}</span></div>
          <div className="account-difference"><strong>{!controller.included.has(account.id) ? t.t('accountNotIncluded') : missing === null ? null : missing === 0 ? t.t('accountNoMissing') : t.t(missing === 1 ? 'accountMissingOne' : 'accountMissing', { count: missing })}</strong></div>
          <dl className="account-other-counts">
            <div><dt>{t.t('archived')}</dt><dd>{account.archived}</dd></div>
            <div><dt>{t.t('scheduledGroup')}</dt><dd>{account.scheduled}</dd></div>
            <div><dt>{t.t('oldOrganizationGroup')}</dt><dd>{account.oldCopies}</dd></div>
          </dl>
          <button type="button" className="account-session-link" disabled={controller.busy} onClick={() => controller.openSessions(account.id)}><span>{t.t('openSessions')}</span><Icon icon="arrow-right" /></button>
        </article>;
      })}</div>
      <SkippedEntriesNotice paths={workspace.skippedPaths} />
    </>}
    {workspace && !checking && <p className="accounts-safety">{t.t('noLoginSwitch')}</p>}
  </StageFrame>;
}

export function ScanStage() {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--state" layout="centered" title={t.t('checkingAccounts')} description={t.t('checkAccountSafety')}>
    <div className="state-stage"><RelayArt state="scanning" /><div className="liquid-progress" aria-hidden="true"><span /></div><p>{t.t('accountsKeychain')}</p></div>
  </StageFrame>;
}

export function ProgressStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const preview = controller.lastPreview;
  const count = changedSessionIds(preview).length;
  const title = preview?.kind === 'sync' ? t.t(count === 1 ? 'syncingCountOne' : 'syncingCount', { count }) : t.t('operationInProgress');
  return <StageFrame className="stage-surface stage-surface--state stage-surface--progress" layout="centered" title={title}
    description={t.t('operationInProgressBody')} header={<RelayArt state="syncing" />}>
    <div className="state-stage"><div className="liquid-progress liquid-progress--wide" role="progressbar" aria-label={title} aria-valuetext={t.t('applying')}><span /></div>
      <p className="progress-cancel-note">{t.t('operationCannotStop')}</p>
    </div>
  </StageFrame>;
}
