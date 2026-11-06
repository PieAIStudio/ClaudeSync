import { Button, Icon } from '@pieai/swimmer-ui-kit';
import { StageFrame } from './StageFrame';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { accountName, SkippedEntriesNotice } from './components';
import { PageArt, RelayArt } from './visuals';

export function HomeStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const workspace = controller.workspace;
  const summary = controller.accountSummary;
  const comparable = controller.included.size >= 2 && controller.targetsVerified;
  const checking = !controller.info || controller.busy || Boolean(controller.info.configured && !workspace && !controller.error);
  return <StageFrame className="stage-surface stage-surface--accounts" eyebrow={`ClaudeSync / ${t.t('accounts')}`}
    title={t.t('accountsTitle')} description={t.t('accountsSub')} header={<PageArt kind="hero" />}
    primaryAction={<Button variant="ghost" static disabled={checking} onClick={() => controller.info?.configured ? void controller.startCheck() : controller.navigate('settings')}><Icon icon="redo" />{t.t('checkAccounts')}</Button>}>
    {!workspace && <div className="account-welcome" role="status">
      <p>{t.t(checking ? 'checkingAccounts' : 'noCheck')}</p>
      <p>{t.t('accountsKeychain')}</p><small>{t.t('checkAccountSafety')}</small>
    </div>}
    {workspace && <>
      {(workspace.identityState !== 'verified' || controller.model.accountCheckFailed) && <p className="account-identity-note" role="status"><Icon icon="alert" />{t.t(workspace.identityState === 'changed' ? 'identityChanged' : workspace.identityState === 'unsupported' ? 'identityUnsupported' : 'accountUnchecked')}</p>}
      <div className="account-grid">{workspace.accounts.map((account) => {
        const counts = summary.accounts.find((item) => item.accountId === account.id);
        const count = account.organizationVerified ? account.visible : null;
        const missing = counts?.missingCount ?? null;
        const name = accountName(account, t);
        const status = (workspace.identityState !== 'verified' || controller.model.accountCheckFailed) ? 'accountUnchecked' : account.current ? 'current' : 'accountNotCurrent';
        return <article className="account-card" key={account.id} data-account-id={account.id} data-current={status === 'current'}>
          <div className="account-card-top"><span className="account-avatar" aria-hidden="true">{(account.email ?? account.id).slice(0, 1).toUpperCase()}</span>
            <span className="account-status" data-status={status}>{t.t(status)}</span></div>
          <h2 title={name}>{name}</h2>
          <div className="account-count"><strong>{count ?? '—'}</strong><span>{t.t(count === null ? 'accountUnavailable' : count === 1 ? 'localCountLabelOne' : 'localCountLabel')}</span></div>
          <p className="account-count-rule">{t.t('accountCountRule')}</p>
          <div className="account-difference"><strong>{!controller.included.has(account.id) ? t.t('accountNotIncluded') : missing === null ? t.t('accountUnavailable') : missing === 0 ? t.t('accountNoMissing') : t.t(missing === 1 ? 'accountMissingOne' : 'accountMissing', { count: missing })}</strong><span>{t.t('accountVersions')}</span></div>
          <dl className="account-other-counts">
            <div><dt>{t.t('archived')}</dt><dd>{account.archived}</dd></div>
            <div><dt>{t.t('scheduledGroup')}</dt><dd>{account.scheduled}</dd></div>
            <div><dt>{t.t('oldOrganizationGroup')}</dt><dd>{account.oldCopies}</dd></div>
          </dl>
          <button type="button" className="account-session-link" disabled={controller.busy} onClick={() => controller.openSessions(account.id)}><span>{t.t('openSessions')}</span><Icon icon="arrow-right" /></button>
        </article>;
      })}</div>
      {workspace.accounts.length === 0 && <p className="empty-state">{t.t('noCheck')}</p>}
      <section className="account-missing-summary">
        <div><h2>{!comparable ? t.t('chooseCompareAccounts') : summary.missingSessionIds.size ? t.t(summary.missingSessionIds.size === 1 ? 'missingSessionOne' : 'missingSessions', { count: summary.missingSessionIds.size }) : t.t('accountNoMissing')}</h2>
          <p>{summary.missingCopies ? t.t(summary.missingCopies === 1 ? 'missingCopyOne' : 'missingCopies', { count: summary.missingCopies }) : t.t('accountVersions')}</p></div>
        <Button variant="primary" className="missing-filter" disabled={controller.busy || !comparable || !summary.missingSessionIds.size} onClick={() => controller.openSessions('all', true)}>{t.t('findMissing')}</Button>
      </section>
      <SkippedEntriesNotice paths={workspace.skippedPaths} />
    </>}
    <p className="accounts-safety">{t.t('noLoginSwitch')}</p>
  </StageFrame>;
}

export function ScanStage() {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--state" layout="centered" title={t.t('checkingAccounts')} description={t.t('checkAccountSafety')}>
    <div className="state-stage"><RelayArt state="scanning" /><div className="liquid-progress" aria-hidden="true"><span /></div><p>{t.t('accountsKeychain')}</p></div>
  </StageFrame>;
}

export function ProgressStage() {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--state" layout="centered" title={t.t('operationInProgress')} description={t.t('operationInProgressBody')}>
    <div className="state-stage"><RelayArt state="syncing" /><div className="liquid-progress liquid-progress--wide" aria-label={t.t('operationInProgress')}><span /></div><p>{t.t('applying')}</p><small>{t.t('waiting')}</small></div>
  </StageFrame>;
}