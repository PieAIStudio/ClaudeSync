import { Button, Callout, Icon, Input, Select } from '@pieai/swimmer-ui-kit';
import { SESSION_GROUPS, type SessionGroup } from '../shared/contracts';
import { StageFrame } from './StageFrame';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { SessionRows, SkippedEntriesNotice, accountName, groupLabels } from './components';
import { TermTip } from './TermTip';

export function ReviewStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const workspace = controller.workspace;
  if (!workspace) return <StageFrame className="stage-surface" title={t.t('localTitle')} description={t.t('localSub')}>
    <p className="empty-state">{t.t('noCheck')}</p><Button variant="primary" onClick={() => void controller.startCheck('results')}>{t.t('checkAccounts')}</Button>
  </StageFrame>;
  const group = controller.selectionGroup;
  const archived = group === 'archived';
  const removalGroup = group === 'scheduled' || group === 'oldOrganization';
  const organize = group === 'visible' || archived;
  const syncGroup = group === 'visible' || group === 'deleted';
  const canSync = syncGroup && controller.canAct && controller.included.size >= 2 && controller.targetsVerified;
  const allSelected = controller.eligibleToSelect.length > 0 && controller.eligibleToSelect.every((session) => controller.selected.has(session.id));
  const someSelected = controller.eligibleToSelect.some((session) => controller.selected.has(session.id));
  const deleteAccounts = controller.deleteTargets.accountIds.map((id) => accountName(workspace.accounts.find((account) => account.id === id), t)).join(', ') || t.t('allAccounts');
  const reviewActions = <div className="review-footer-actions">
    <div className="action-buttons">
      <div className="selection-summary" aria-live="polite">
        <strong>{t.t(controller.selectedSourceAccountCount === 1 ? 'selectionSourceOne' : 'selectionSources', { count: controller.selected.size, accounts: controller.selectedSourceAccountCount })}</strong>
        <span>{controller.hiddenSelected > 0 ? t.t('hiddenSelected', { count: controller.hiddenSelected }) : !canSync && syncGroup ? t.t('reviewSyncHelp') : t.t(archived ? 'organizeHelp' : 'participationHelp')}</span>
      </div>
      {removalGroup ? <Button variant="danger" static disabled={controller.busy || !controller.deleteTargets.sessionIds.length} onClick={controller.openDeleteConfirmation}>{t.t(group === 'scheduled' ? 'deleteLeftovers' : 'delete')}</Button>
        : <Button variant="primary" static disabled={archived ? !controller.canAct : !canSync} onClick={() => void controller.action(archived ? 'unarchive' : 'sync')}>{t.t(archived ? 'unarchive' : 'reviewSync')}</Button>}
      <details className="more-actions"><summary>{t.t('more')}</summary><div>
        <fieldset className="action-group" disabled={!organize}><h3>{t.t('actionGroupOrganize')}</h3>
          <Button variant="ghost" static disabled={!controller.canAct || controller.included.size < 2 || !controller.targetsVerified || group !== 'visible'} onClick={() => void controller.action('keep')}>{t.t('keep')}</Button>
          <Button variant="ghost" static disabled={!controller.canAct} onClick={() => void controller.action('archive')}>{t.t('archive')}</Button>
          <Button variant="ghost" static disabled={!controller.canAct} onClick={() => void controller.action('unarchive')}>{t.t('unarchive')}</Button>
          <Button variant="ghost" static disabled={!controller.canAct || controller.selected.size !== 1} onClick={controller.openRename}>{t.t('rename')}</Button>
          <Button variant="ghost" static disabled={!controller.canAct} onClick={() => void controller.action('star')}>{t.t('star')}</Button>
          <Button variant="ghost" static disabled={!controller.canAct} onClick={() => void controller.action('unstar')}>{t.t('unstar')}</Button>
        </fieldset>
        <section className="action-group action-group--danger"><h3>{t.t('actionGroupDestructive')}</h3>
          <p>{t.t(group === 'scheduled' || group === 'deleted' ? 'leftoverDeleteNote' : 'actionDeleteNote')}</p>
          <p>{t.t(controller.deleteTargets.sessionIds.length === 1 ? 'deleteScopeTipOne' : 'deleteScopeTip', { accounts: deleteAccounts, count: controller.deleteTargets.sessionIds.length })}</p>
          <Button variant="danger" static disabled={controller.busy || !controller.deleteTargets.sessionIds.length} onClick={controller.openDeleteConfirmation}>{t.t(group === 'scheduled' || group === 'deleted' ? 'deleteLeftovers' : 'delete')}</Button>
          <p>{t.t('actionCleanupNote')}</p><span className="count-with-tip"><Button variant="ghost" static disabled={controller.busy || !controller.canReviewOldCopies} onClick={() => void controller.reviewOldCopies()}>{t.t('cleanupOldButton')}</Button><TermTip term="oldCleanup" /></span>
        </section>
      </div></details>
    </div>
  </div>;
  return <StageFrame className="stage-surface stage-surface--review stage-surface--sessions" title={t.t('localTitle')} description={t.t('localSub')} footer={reviewActions}>
    <section className="review-main">
      <div className="list-context">
        <label className="viewing-control"><span>{t.t('viewingAccount')}</span><span className="accounts-toolbar-select"><Select className="account-view-filter" aria-label={t.t('viewingAccount')} value={controller.accountFilter} disabled={controller.busy} onChange={(event) => controller.browseAccount(event.target.value)}>
          <option value="all">{t.t('allAccounts')}</option>{workspace.accounts.map((account) => <option key={account.id} value={account.id}>{accountName(account, t)}</option>)}
        </Select><span className="accounts-toolbar-select__chevron" aria-hidden="true"><Icon icon="chevron-down" size="sm" /></span></span></label>
        <fieldset className="action-account-strip" disabled={controller.busy}>
          <legend>{t.t(archived ? 'organizeAccounts' : 'useAccounts')}</legend>
          <div>{workspace.accounts.map((account) => <label key={account.id} title={accountName(account, t)}>
            <input type="checkbox" checked={controller.included.has(account.id)} aria-label={`${t.t('includeAccount')} ${accountName(account, t)}`} onChange={(event) => controller.includeAccount(account.id, event.target.checked)} />
            <span>{accountName(account, t)}</span>
          </label>)}</div><small>{t.t(archived ? 'organizeHelp' : 'participationHelp')}</small>
        </fieldset>
        <Button variant="ghost" size="sm" static className="list-refresh" disabled={controller.busy} onClick={() => void controller.startCheck('results')}><Icon icon="redo" size="sm" />{t.t('checkAgain')}</Button>
      </div>
      <div className="list-toolbar">
        <label className="session-group-control"><span>{t.t('sessionGroup')}</span><span className="accounts-toolbar-select"><Select className="session-group-filter" aria-label={t.t('sessionGroup')} value={group} disabled={controller.busy} onChange={(event) => controller.browseGroup(event.target.value as SessionGroup)}>
          {SESSION_GROUPS.map((item) => <option key={item} value={item}>{t.t(groupLabels[item])} · {controller.scopedGroups[item].length}</option>)}
        </Select><span className="accounts-toolbar-select__chevron" aria-hidden="true"><Icon icon="chevron-down" size="sm" /></span></span></label>
        <Input type="search" aria-label={t.t('search')} placeholder={t.t('search')} value={controller.search} onChange={(event) => controller.setSearch(event.target.value)} />
        {group === 'visible' && <button type="button" className="missing-filter" aria-pressed={controller.missingOnly} onClick={() => controller.setMissingOnly(!controller.missingOnly)}>{t.t('missingFilter')}</button>}
        <details className="filter-drawer"><summary>{t.t('filterSort')}</summary><div>
          <label>{t.t('filter')}<Select aria-label={t.t('filter')} value={controller.filter} onChange={(event) => controller.setFilter(event.target.value as typeof controller.filter)}>{(['all', 'syncable', 'blocked', 'starred'] as const).map((key) => <option key={key} value={key}>{t.t(key)}</option>)}</Select></label>
          <label>{t.t('sort')}<Select aria-label={t.t('sort')} value={controller.sort} onChange={(event) => controller.setSort(event.target.value as 'updated' | 'title')}><option value="updated">{t.t('sortUpdated')}</option><option value="title">{t.t('sortTitle')}</option></Select></label>
        </div></details>
      </div>
      <div className="select-line"><label><input type="checkbox" checked={allSelected} disabled={controller.busy || !controller.eligibleToSelect.length}
        ref={(element) => { if (element) element.indeterminate = someSelected && !allSelected; }}
        onChange={(event) => { const value = event.target.checked; controller.setSelected((current) => { const next = new Set(current); for (const session of controller.eligibleToSelect) { if (value) next.add(session.id); else next.delete(session.id); } return next; }); }} />{t.t('selectVisible')}</label>
        <details className="selection-menu"><summary>{t.t('selectMenu')}</summary><div>
          <Button variant="ghost" static disabled={controller.busy || !controller.recentEligible.length} onClick={() => controller.setSelected(new Set(controller.recentEligible.map((session) => session.id)))}>{t.t(!controller.recentEligible.length ? 'noRecentSelection' : archived ? 'recentArchived' : group === 'deleted' ? 'recentSurviving' : controller.recentEligible.length === 1 ? 'recentSelectionOne' : 'recentSelection', { count: controller.recentEligible.length })}</Button>
          <Button variant="ghost" static disabled={controller.busy || !controller.selected.size} onClick={() => controller.setSelected(new Set())}>{t.t('clearSelection')}</Button>
        </div></details>
        <span className="visible-total">{t.t('visibleCount', { shown: controller.reviewSessions.length, total: controller.scopedGroups[group].length })}</span>
      </div>
      <div className="review-list-wrap">
        {group !== 'visible' && <div className="session-group-note"><strong>{t.t(groupLabels[group])}</strong><TermTip term={group} /></div>}
        {controller.reviewSessions.length ? <SessionRows sessions={controller.reviewSessions} accounts={workspace.accounts} catalog={workspace.sessions} missingAccounts={controller.accountSummary.accounts} selected={controller.selected}
          filterId={controller.accountFilter} included={controller.included} onToggle={(id, value) => controller.toggle(group, id, value)} busy={controller.busy} group={group} />
          : <div className="list-empty-state" role="status"><p className="empty-state">{t.t(controller.scopedGroups[group].length ? 'noSessions' : archived ? 'noArchivedSessions' : 'noGroupSessions')}</p>
            {controller.scopedGroups[group].length > 0 && controller.search.trim() && <Button variant="ghost" static size="sm" onClick={() => controller.setSearch('')}>{t.t('clearSearch')}</Button>}
          </div>}
        <SkippedEntriesNotice paths={workspace.skippedPaths} />
      </div>
      {controller.accountFilter !== 'all' && <p className="list-scope-note">{t.t('viewingHelp')}</p>}
      {!controller.targetsVerified && <div className="operation-warning count-with-tip"><span>{t.t('unverifiedWrite')}</span><TermTip term="unverified" /></div>}
      {controller.cleanupFeedback && <Callout tone="warning">{controller.cleanupFeedback}</Callout>}
    </section>
  </StageFrame>;
}